const Exam = require('../../models/exam/Exam');
const ExamSet = require('../../models/exam/ExamSet');
const Question = require('../../models/exam/ExamQuestion');
const Candidate = require('../../models/exam/ExamCandidate');
const Attempt = require('../../models/exam/ExamAttempt');
const audit = require('../../services/exam/examAudit');
const { availableFilter, pick } = require('./helpers');
const { normalizeConfig, effectiveConfig } = require('../../services/exam/proctoringPolicy');
const { invalidateExam } = require('../../services/exam/examCache');
const { planGoLive } = require('../../services/exam/goLivePolicy');

const FIELDS = [
  'name', 'description', 'instructions', 'category', 'durationMinutes', 'maximumMarks', 'passingMarks',
  'startsAt', 'endsAt', 'randomizeQuestions', 'randomizeOptions', 'allowMultipleAttempts',
  'negativeMarking', 'negativeMarkValue', 'proctoringEnabled', 'maxWarnings',
  'aiEvaluation', 'showResultToCandidate',
];

function validate(b, existing = {}) {
  const m = { ...(existing.toObject ? existing.toObject() : existing), ...b };
  if (b.startsAt === '') b.startsAt = null;
  if (b.endsAt === '') b.endsAt = null;
  const starts = b.startsAt !== undefined ? b.startsAt : m.startsAt;
  const ends = b.endsAt !== undefined ? b.endsAt : m.endsAt;
  if (starts && ends && new Date(ends) <= new Date(starts)) return 'End time must be after the start time';
  if (m.passingMarks > m.maximumMarks) return 'Passing marks cannot exceed maximum marks';
  return null;
}

exports.listPublic = async (req, res) => {
  const rows = await Exam.find(availableFilter())
    .select('name description category durationMinutes maximumMarks startsAt endsAt proctoringEnabled maxWarnings aiProctoring.enabled')
    .sort({ createdAt: -1 })
    .lean();
  res.json(rows);
};

exports.getPublic = async (req, res) => {
  const e = await Exam.findOne({ _id: req.params.id, ...availableFilter() }).select(
    'name description instructions category durationMinutes maximumMarks passingMarks startsAt endsAt proctoringEnabled maxWarnings aiProctoring.enabled aiProctoring.cameraRequired'
  ).lean();
  if (!e) return res.status(404).json({ message: 'Exam not available' });
  res.json(e);
};

exports.list = async (req, res) => {
  const exams = await Exam.find().sort({ createdAt: -1 }).lean();
  const [sets, cands] = await Promise.all([
    ExamSet.aggregate([{ $group: { _id: '$exam', sets: { $sum: 1 }, questions: { $sum: { $size: '$questions' } } } }]),
    Candidate.aggregate([{ $group: { _id: '$exam', n: { $sum: 1 } } }]),
  ]);
  const sm = new Map(sets.map((s) => [String(s._id), s]));
  const cm = new Map(cands.map((c) => [String(c._id), c.n]));
  res.json(
    exams.map((e) => ({
      ...e,
      setCount: sm.get(String(e._id))?.sets || 0,
      questionCount: sm.get(String(e._id))?.questions || 0,
      candidateCount: cm.get(String(e._id)) || 0,
    }))
  );
};

exports.get = async (req, res) => {
  const e = await Exam.findById(req.params.id).lean();
  if (!e) return res.status(404).json({ message: 'Exam not found' });
  const sets = await ExamSet.find({ exam: e._id }).select('questions isActive').lean();
  res.json({
    ...e,
    setCount: sets.length,
    activeSetCount: sets.filter((s) => s.isActive).length,
    questionCount: sets.reduce((n, s) => n + (s.questions?.length || 0), 0),
  });
};

exports.create = async (req, res) => {
  const body = pick(req.body, FIELDS);
  if (req.body?.aiProctoring !== undefined) body.aiProctoring = normalizeConfig(req.body.aiProctoring);
  const err = validate(body);
  if (err) return res.status(400).json({ message: err });
  // const e = await Exam.create({ ...body, createdBy: req.user._id });
  const e = await Exam.create({ ...body, createdBy: req.examAdmin._id});
  await audit(req, 'EXAM_CREATED', e._id);
  res.status(201).json(e);
};

exports.update = async (req, res) => {
  const existing = await Exam.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Exam not found' });
  const body = pick(req.body, FIELDS);
  const ai = req.body?.aiProctoring !== undefined ? normalizeConfig(req.body.aiProctoring) : null;
  const err = validate(body, existing);
  if (err) return res.status(400).json({ message: err });
  existing.set(body);
  if (ai) for (const [k, v] of Object.entries(ai)) existing.set(`aiProctoring.${k}`, v); // merge, never replace wholesale
  await existing.save();
  invalidateExam(existing._id);
  await audit(req, 'EXAM_UPDATED', existing._id);
  res.json(existing);
};

exports.remove = async (req, res) => {
  const e = await Exam.findById(req.params.id);
  if (!e) return res.status(404).json({ message: 'Exam not found' });
  if (await Attempt.exists({ exam: e._id })) {
    return res.status(409).json({ message: 'This exam already has candidate attempts. Archive it instead of deleting.' });
  }
  const sets = await ExamSet.find({ exam: e._id }).select('_id');
  await Question.deleteMany({ set: { $in: sets.map((s) => s._id) } });
  await ExamSet.deleteMany({ exam: e._id });
  await Candidate.deleteMany({ exam: e._id });
  await e.deleteOne();
  await audit(req, 'EXAM_DELETED', e._id);
  res.json({ message: 'Exam deleted' });
};

// exports.status = async (req, res) => {
//   const allowed = ['Draft', 'Scheduled', 'Live', 'Paused', 'Completed', 'Archived'];
//   const { status } = req.body || {};
//   if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });
//   if (status === 'Live') {
//     const ready = await ExamSet.exists({ exam: req.params.id, isActive: true, 'questions.0': { $exists: true } });
//     if (!ready) return res.status(400).json({ message: 'Add at least one active question set with questions before going live' });
//   }
//   const e = await Exam.findByIdAndUpdate(req.params.id, { status }, { new: true });
//   if (!e) return res.status(404).json({ message: 'Exam not found' });
//   await audit(req, 'EXAM_STATUS_CHANGED', e._id, { status: e.status });
//   res.json(e);
// };

exports.status = async (req, res) => {
  const allowed = ['Draft', 'Scheduled', 'Live', 'Paused', 'Completed', 'Archived'];
  const { status } = req.body || {};
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });

  let update = { status };
  let note = null;
  if (status === 'Live') {
    const ready = await ExamSet.exists({ exam: req.params.id, isActive: true, 'questions.0': { $exists: true } });
    if (!ready) return res.status(400).json({ message: 'Add at least one active question set with questions before going live' });

    const current = await Exam.findById(req.params.id).select('status startsAt endsAt').lean();
    if (!current) return res.status(404).json({ message: 'Exam not found' });
    const plan = planGoLive({ exam: current, newEndsAt: req.body.endsAt, noEndTime: req.body.noEndTime === true });
    if (!plan.ok) return res.status(400).json({ message: plan.error, needsEndTime: !!plan.needsEndTime });
    update = plan.update;
    note = plan.note;
  }

  const e = await Exam.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!e) return res.status(404).json({ message: 'Exam not found' });
  invalidateExam(e._id);
  await audit(req, 'EXAM_STATUS_CHANGED', e._id, { status: e.status, ...(update.endsAt !== undefined ? { endsAt: update.endsAt } : {}) });
  res.json({ ...e.toObject(), note });
};
