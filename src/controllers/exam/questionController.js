const fs = require('fs');
const path = require('path');
const Q = require('../../models/exam/ExamQuestion');
const ExamSet = require('../../models/exam/ExamSet');
const { pick } = require('./helpers');
const { invalidateSet } = require('../../services/exam/examCache');

const TYPES = ['MCQ', 'MULTI_SELECT', 'TRUE_FALSE', 'SHORT_ANSWER', 'LONG_ANSWER'];
const FIELDS = [
  'title', 'description', 'images', 'type', 'options', 'correctAnswers', 'modelAnswer',
  'evaluationGuidelines', 'marks', 'negativeMarks', 'difficulty', 'topic', 'explanation', 'order',
];

// Normalises + validates a question payload. Returns { error } or { data }.
function prepare(input, existing = null) {
  const b = pick(input, FIELDS);
  const m = { ...(existing ? existing.toObject() : {}), ...b };
  if (!String(m.title || '').trim()) return { error: 'Question text is required' };
  if (!TYPES.includes(m.type)) return { error: 'Invalid question type' };
  if (!(Number(m.marks) >= 0)) return { error: 'Marks must be zero or more' };
  b.marks = Number(m.marks);
  if (b.negativeMarks !== undefined) b.negativeMarks = Math.max(0, Number(b.negativeMarks) || 0);
  if (b.images) b.images = (b.images || []).map(String).filter((u) => /^https?:\/\//i.test(u)).slice(0, 6);

  if (m.type === 'TRUE_FALSE') {
    b.options = [{ label: 'True', value: 'true' }, { label: 'False', value: 'false' }];
    const c = (m.correctAnswers || []).map(String);
    if (c.length !== 1 || !['true', 'false'].includes(c[0])) return { error: 'Choose True or False as the correct answer' };
    b.correctAnswers = c;
  } else if (m.type === 'MCQ' || m.type === 'MULTI_SELECT') {
    const opts = (m.options || []).map((o) => ({ label: String(o.label || '').trim(), value: String(o.value || '').trim() }));
    if (opts.length < 2 || opts.length > 10) return { error: 'Add between 2 and 10 options' };
    if (opts.some((o) => !o.label || !o.value)) return { error: 'Every option needs text' };
    const values = opts.map((o) => o.value);
    if (new Set(values).size !== values.length) return { error: 'Option values must be unique' };
    const c = [...new Set((m.correctAnswers || []).map(String))];
    if (!c.length) return { error: 'Mark at least one correct answer' };
    if (c.some((v) => !values.includes(v))) return { error: 'Correct answer must match an option' };
    if (m.type === 'MCQ' && c.length !== 1) return { error: 'A single-choice question has exactly one correct answer' };
    b.options = opts;
    b.correctAnswers = c;
  } else {
    b.options = [];
    b.correctAnswers = [];
  }
  return { data: b };
}

async function recalcSet(setId) {
  invalidateSet(setId); // candidates' cached paper/option metadata must not outlive an edit
  const agg = await Q.aggregate([{ $match: { set: new (require('mongoose').Types.ObjectId)(String(setId)) } }, { $group: { _id: null, t: { $sum: '$marks' } } }]);
  const ids = await Q.find({ set: setId }).sort({ order: 1, createdAt: 1 }).select('_id');
  await ExamSet.findByIdAndUpdate(setId, { totalMarks: agg[0]?.t || 0, questions: ids.map((i) => i._id) });
}

exports.list = async (req, res) => res.json(await Q.find({ set: req.params.setId }).sort({ order: 1, createdAt: 1 }));

exports.create = async (req, res) => {
  if (!(await ExamSet.exists({ _id: req.params.setId }))) return res.status(404).json({ message: 'Set not found' });
  const { error, data } = prepare(req.body);
  if (error) return res.status(400).json({ message: error });
  if (data.order === undefined) data.order = await Q.countDocuments({ set: req.params.setId });
  const q = await Q.create({ ...data, set: req.params.setId });
  await recalcSet(req.params.setId);
  res.status(201).json(q);
};

exports.update = async (req, res) => {
  const existing = await Q.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Question not found' });
  const { error, data } = prepare(req.body, existing);
  if (error) return res.status(400).json({ message: error });
  existing.$set(data); // NB: "set" is also a schema path on this model, so use $set()
  await existing.save();
  await recalcSet(existing.set);
  res.json(existing);
};

exports.remove = async (req, res) => {
  const q = await Q.findByIdAndDelete(req.params.id);
  if (q) await recalcSet(q.set);
  res.json({ message: 'Question deleted' });
};

// Question images are stored on Cloudinary (same account as other uploads).
exports.uploadImage = async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Choose an image to upload' });
  const cleanup = () => fs.unlink(file.path, () => {});
  try {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext) || !/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return res.status(400).json({ message: 'Only JPG, PNG or WEBP images are allowed' });
    }
    if (file.size > 5 * 1024 * 1024) return res.status(400).json({ message: 'Image must be smaller than 5 MB' });
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      return res.status(503).json({ message: 'Image storage is not configured. Paste an image URL instead.' });
    }
    const cloudinary = require('../../config/cloudinary');
    const up = await cloudinary.uploader.upload(file.path, { folder: 'exam-questions', resource_type: 'image' });
    res.json({ url: up.secure_url });
  } finally {
    cleanup();
  }
};
exports._prepare = prepare; // exported for tests
