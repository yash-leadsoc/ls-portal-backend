const Set = require('../../models/exam/ExamSet');
const Exam = require('../../models/exam/Exam');
const Question = require('../../models/exam/ExamQuestion');
const Attempt = require('../../models/exam/ExamAttempt');
const { pick } = require('./helpers');

const dupMsg = 'A set with this name already exists in this exam';
const view = (s) => ({ ...s, questionCount: (s.questions || []).length, questions: undefined });

exports.list = async (req, res) => {
  const rows = await Set.find({ exam: req.params.examId }).sort({ createdAt: 1 }).lean();
  res.json(rows.map(view));
};

exports.get = async (req, res) => {
  const s = await Set.findById(req.params.id).populate('exam', 'name').lean();
  if (!s) return res.status(404).json({ message: 'Set not found' });
  res.json(view(s));
};

exports.create = async (req, res) => {
  if (!(await Exam.exists({ _id: req.params.examId }))) return res.status(404).json({ message: 'Exam not found' });
  const body = pick(req.body, ['name', 'description', 'isActive']);
  if (!String(body.name || '').trim()) return res.status(400).json({ message: 'Set name is required' });
  try {
    res.status(201).json(await Set.create({ ...body, exam: req.params.examId }));
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: dupMsg });
    throw e;
  }
};

exports.update = async (req, res) => {
  try {
    const x = await Set.findByIdAndUpdate(req.params.id, pick(req.body, ['name', 'description', 'isActive']), { new: true, runValidators: true });
    if (!x) return res.status(404).json({ message: 'Set not found' });
    res.json(x);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: dupMsg });
    throw e;
  }
};

exports.remove = async (req, res) => {
  if (await Attempt.exists({ examSet: req.params.id })) {
    return res.status(409).json({ message: 'Candidates have already attempted this set. Deactivate it instead of deleting.' });
  }
  await Question.deleteMany({ set: req.params.id });
  await Set.findByIdAndDelete(req.params.id);
  res.json({ message: 'Set deleted' });
};
