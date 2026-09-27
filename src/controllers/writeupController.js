const Writeup = require('../models/Writeup');
const { bumpStreak } = require('../utils/streak');
const WriteupAnswer = require('../models/WriteupAnswer');
const Document = require('../models/Document');
const { logAudit } = require('../utils/audit');
exports.create = async (req, res) => {
  const { title, domainId, questions } = req.body;
  if (!domainId) return res.status(400).json({ message: 'Domain is required' });
  const existing = await Writeup.findOne({ domain: domainId, active: true });
  if (existing) return res.status(409).json({ message: 'This domain already has a write-up' });
  const writeup = await Writeup.create({
    title, domain: domainId, document: null,
    questions: (questions || []).map((q, i) => ({
      text: q.text, section: q.section || 'General', order: q.order != null ? q.order : i,
    })),
    createdBy: req.user._id,
  });
   await logAudit(req, {
    action: 'create', entity: 'writeup',
    entityId: writeup._id, entityLabel: writeup.title,
  });
  res.status(201).json({ writeup });
};

exports.writeupForDomain = async (req, res) => {
  const writeup = await Writeup.findOne({ domain: req.params.domainId, active: true });
  res.json({ writeup: writeup || null });
};

exports.deleteWriteup = async (req, res) => {
  const w = await Writeup.findById(req.params.id);
  if (!w) return res.status(404).json({ message: 'Write-up not found' });
   await logAudit(req, {
    action: 'delete', entity: 'writeup',
    entityId: w._id, entityLabel: w.title,
  });
  await w.deleteOne();
  res.json({ message: 'Write-up deleted' });
};

exports.listByDocument = async (req, res) => {
  const writeups = await Writeup.find({ document: req.params.documentId, active: true }).sort({
    createdAt: 1,
  });
  res.json({ writeups });
};

exports.getOne = async (req, res) => {
  const writeup = await Writeup.findById(req.params.id);
  if (!writeup) return res.status(404).json({ message: 'Write-up not found' });
  res.json({ writeup });
};

exports.update = async (req, res) => {
  const writeup = await Writeup.findById(req.params.id);
  if (!writeup) return res.status(404).json({ message: 'Write-up not found' });
  if (req.user.role !== 'admin' && String(writeup.createdBy) !== String(req.user._id)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  if (req.body.title) writeup.title = req.body.title;
  if (Array.isArray(req.body.questions)) {
    writeup.questions = req.body.questions.map((q, i) => ({
      text: q.text,
      section: q.section || 'General',
      order: q.order != null ? q.order : i,
    }));
  }
  await writeup.save();
  res.json({ writeup });
};

exports.remove = async (req, res) => {
  const writeup = await Writeup.findById(req.params.id);
  if (!writeup) return res.status(404).json({ message: 'Write-up not found' });
  if (req.user.role !== 'admin' && String(writeup.createdBy) !== String(req.user._id)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  writeup.active = false;
  await writeup.save();
  res.json({ message: 'Write-up archived' });
};

exports.myAnswer = async (req, res) => {
  const writeup = await Writeup.findById(req.params.id);
  if (!writeup) return res.status(404).json({ message: 'Write-up not found' });
  let answer = await WriteupAnswer.findOne({ writeup: writeup._id, employee: req.user._id });
  if (!answer) answer = { writeup: writeup._id, employee: req.user._id, answers: [] };
  res.json({ writeup, answer });
};

exports.saveAnswer = async (req, res) => {
  const writeup = await Writeup.findById(req.params.id);
  if (!writeup) return res.status(404).json({ message: 'Write-up not found' });
  const { answers } = req.body;
  if (!Array.isArray(answers)) return res.status(400).json({ message: 'answers array required' });
  const saved = await WriteupAnswer.findOneAndUpdate(
    { writeup: writeup._id, employee: req.user._id },
    { $set: { answers } },
    { upsert: true, new: true }
  );
  bumpStreak(req.user._id);
    res.json({ answer: saved });
};

exports.updateWriteup = async (req, res) => {
  try {
    const writeup = await Writeup.findById(req.params.id);
    if (!writeup) return res.status(404).json({ message: 'Write-up not found' });

    if (req.body.title != null) writeup.title = req.body.title;
    if (Array.isArray(req.body.questions)) {
      writeup.questions = req.body.questions.map((q, i) => ({
        text: q.text,
        section: q.section || 'General',
        order: q.order != null ? q.order : i,
      }));
    }
    await writeup.save();
    await logAudit(req, {
    action: 'update', entity: 'writeup',
    entityId: writeup._id, entityLabel: writeup.title,
  });
    res.json({ writeup });
  } catch (e) {
    res.status(500).json({ message: 'Could not update write-up' });
  }
};
