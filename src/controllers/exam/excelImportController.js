
const XLSX = require('xlsx');
const mongoose = require('mongoose');

const Exam = require('../../models/exam/Exam');
const ExamSet = require('../../models/exam/ExamSet');
const ExamQuestion = require('../../models/exam/ExamQuestion');
const ExamAttempt = require('../../models/exam/ExamAttempt');
const { invalidateSet } = require('../../services/exam/examCache');

const MAX_SHEETS = 20;
const MAX_QUESTIONS = 5000;
const LETTERS = ['A', 'B', 'C', 'D'];

function normalise(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
  });

  if (!workbook.SheetNames.length) {
    throw new Error('The Excel workbook has no worksheets');
  }

  if (workbook.SheetNames.length > MAX_SHEETS) {
    throw new Error(`Maximum ${MAX_SHEETS} worksheets are allowed`);
  }

  const sets = [];
  const errors = [];
  let totalQuestions = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });

    const headerIndex = rows.findIndex(row => {
      const headers = row.map(normalise);

      return (
        headers.includes('question') &&
        headers.includes('optiona') &&
        headers.includes('optionb') &&
        headers.includes('optionc') &&
        headers.includes('optiond') &&
        headers.includes('answerkey')
      );
    });

    if (headerIndex === -1) {
      errors.push({
        sheet: sheetName,
        row: 0,
        message: 'Required headers not found. Expected Question, Option A-D and Answer Key.',
      });
      continue;
    }

    const headers = rows[headerIndex].map(normalise);

    const columns = {
      question: headers.indexOf('question'),
      A: headers.indexOf('optiona'),
      B: headers.indexOf('optionb'),
      C: headers.indexOf('optionc'),
      D: headers.indexOf('optiond'),
      answer: headers.indexOf('answerkey'),
    };

    const questions = [];

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];

      const title = String(row[columns.question] ?? '').trim();
      const options = LETTERS.map(letter =>
        String(row[columns[letter]] ?? '').trim()
      );
      const answer = String(row[columns.answer] ?? '').trim().toUpperCase();

      if (!title && options.every(v => !v) && !answer) continue;

      const missing = [];
      if (!title) missing.push('Question');
      LETTERS.forEach((letter, index) => {
        if (!options[index]) missing.push(`Option ${letter}`);
      });

      if (missing.length) {
        errors.push({
          sheet: sheetName,
          row: i + 1,
          message: `Missing: ${missing.join(', ')}`,
        });
        continue;
      }

      if (!LETTERS.includes(answer)) {
        errors.push({
          sheet: sheetName,
          row: i + 1,
          message: 'Answer Key must be A, B, C or D',
        });
        continue;
      }

      questions.push({
        title,
        type: 'MCQ',
        options: LETTERS.map((letter, index) => ({
          label: options[index],
          value: letter,
        })),
        correctAnswers: [answer],
        marks: 1,
        negativeMarks: 0,
        difficulty: 'Medium',
        order: questions.length,
      });

      totalQuestions++;

      if (totalQuestions > MAX_QUESTIONS) {
        throw new Error(`Maximum ${MAX_QUESTIONS} questions are allowed`);
      }
    }

    if (!questions.length) {
      errors.push({
        sheet: sheetName,
        row: 0,
        message: 'This worksheet contains no valid questions',
      });
    }

    sets.push({
      name: sheetName.trim(),
      questions,
    });
  }

  const names = sets.map(s => s.name.toLowerCase());

  if (new Set(names).size !== names.length) {
    errors.push({
      sheet: '',
      row: 0,
      message: 'Worksheet names must be unique (case-insensitive)',
    });
  }

  return {
    sets,
    totalQuestions,
    errors,
  };
}

exports.importExcel = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: 'Please upload an Excel file',
    });
  }

  const examId = req.params.examId;

  if (!mongoose.isValidObjectId(examId)) {
    return res.status(400).json({ message: 'Invalid exam ID' });
  }

  const exam = await Exam.findById(examId).select('_id').lean();

  if (!exam) {
    return res.status(404).json({ message: 'Exam not found' });
  }

  let parsed;

  try {
    parsed = parseWorkbook(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  const preview = req.query.preview === 'true';

  if (parsed.errors.length) {
    return res.status(422).json({
      message: 'Excel validation failed. Correct the errors and upload again.',
      ...parsed,
    });
  }

  if (!parsed.sets.length) {
    return res.status(400).json({
      message: 'No valid question sets found',
    });
  }

  if (preview) {
    return res.json({
      message: 'Excel validation successful',
      sets: parsed.sets.map(s => ({
        name: s.name,
        questionCount: s.questions.length,
      })),
      totalSets: parsed.sets.length,
      totalQuestions: parsed.totalQuestions,
      errors: [],
    });
  }

  // Do not change an exam's question structure after candidates have started.
  if (await ExamAttempt.exists({ exam: examId })) {
    return res.status(409).json({
      message: 'This exam already has candidate attempts. Import questions into a new exam instead.',
    });
  }

  const existingNames = await ExamSet.find({
    exam: examId,
    name: { $in: parsed.sets.map(s => s.name) },
  }).select('name').lean();

  if (existingNames.length) {
    return res.status(409).json({
      message: 'Some worksheet names already exist as sets in this exam.',
      duplicates: existingNames.map(s => s.name),
    });
  }

  const createdSetIds = [];

  try {
    for (const item of parsed.sets) {
      const set = await ExamSet.create({
        exam: examId,
        name: item.name,
        description: `Imported from Excel worksheet: ${item.name}`,
        isActive: true,
        questions: [],
        totalMarks: 0,
      });

      createdSetIds.push(set._id);

      const docs = item.questions.map(q => ({
        ...q,
        set: set._id,
      }));

      const inserted = await ExamQuestion.insertMany(docs, {
        ordered: true,
      });

      const totalMarks = inserted.reduce(
        (sum, q) => sum + Number(q.marks || 0),
        0
      );

      await ExamSet.findByIdAndUpdate(set._id, {
        questions: inserted.map(q => q._id),
        totalMarks,
      });

      invalidateSet(set._id);
    }

    return res.status(201).json({
      message: 'Excel imported successfully',
      totalSets: parsed.sets.length,
      totalQuestions: parsed.totalQuestions,
      sets: parsed.sets.map(s => ({
        name: s.name,
        questionCount: s.questions.length,
      })),
    });
  } catch (err) {
    // Roll back all sets/questions created by this import.
    await ExamQuestion.deleteMany({
      set: { $in: createdSetIds },
    }).catch(() => {});

    await ExamSet.deleteMany({
      _id: { $in: createdSetIds },
    }).catch(() => {});

    createdSetIds.forEach(id => invalidateSet(id));

    if (err.code === 11000) {
      return res.status(409).json({
        message: 'A question set with this name already exists',
      });
    }

    throw err;
  }
};
