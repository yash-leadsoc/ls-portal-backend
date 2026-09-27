const cloudinary = require('../config/cloudinary');
const Exercise = require('../models/Exercise');
const ExerciseSubmission = require('../models/ExerciseSubmission');
const { buOf } = require('../utils/scope');
const { bumpStreak } = require('../utils/streak');

exports.listForDomain = async (req, res) => {
  try {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ message: 'domain is required' });
    const exercises = await Exercise.find({ domain, active: true }).sort({ order: 1, createdAt: 1 });
    let subMap = {};
    if (req.user.role === 'employee') {
      const subs = await ExerciseSubmission.find({ employee: req.user._id, exercise: { $in: exercises.map((e) => e._id) } });
      subs.forEach((s) => (subMap[String(s.exercise)] = s));
    }
    res.json({
      exercises: exercises.map((e) => ({
        _id: e._id, title: e.title, instructions: e.instructions,
        refType: e.refType, refFileUrl: e.refFileUrl, refOriginalName: e.refOriginalName, refLink: e.refLink,
        createdAt: e.createdAt,
        my: subMap[String(e._id)] ? { completed: subMap[String(e._id)].completed, driveLink: subMap[String(e._id)].driveLink } : { completed: false, driveLink: '' },
      })),
    });
  } catch (e) {  res.status(500).json({ message: 'Could not load exercises' }); }
};

exports.create = async (req, res) => {
  try {
    const { domainId, title, instructions, refType, refLink } = req.body;
    if (!domainId) return res.status(400).json({ message: 'Domain is required' });
    if (!title || !title.trim()) return res.status(400).json({ message: 'Title is required' });
    let refFileUrl = null, refOriginalName = '', link = null, type = refType || 'none';
    if (type === 'file') {
      if (!req.file) return res.status(400).json({ message: 'A file is required' });
      const up = await cloudinary.uploader.upload(req.file.path, { resource_type: 'auto', folder: 'exercises', use_filename: true, unique_filename: true });
      refFileUrl = up.secure_url; refOriginalName = req.file.originalname;
    } else if (type === 'link') {
      if (!refLink || !refLink.trim()) return res.status(400).json({ message: 'A link is required' });
      link = refLink.trim();
    }
    const ex = await Exercise.create({
      domain: domainId, businessUnit: buOf(req.user) || null,
      title: title.trim(), instructions: instructions || '',
      refType: type, refFileUrl, refOriginalName, refLink: link, createdBy: req.user._id,
    });
    res.status(201).json({ exercise: ex });
  } catch (e) {  res.status(500).json({ message: 'Could not create exercise' }); }
};

exports.update = async (req, res) => {
  const ex = await Exercise.findById(req.params.id);
  if (!ex) return res.status(404).json({ message: 'Exercise not found' });
  const { title, instructions, refLink } = req.body;
  if (title != null) ex.title = title;
  if (instructions != null) ex.instructions = instructions;
  if (refLink != null && ex.refType === 'link') ex.refLink = refLink;
  await ex.save();
  res.json({ exercise: ex });
};

exports.remove = async (req, res) => {
  const ex = await Exercise.findById(req.params.id);
  if (!ex) return res.status(404).json({ message: 'Exercise not found' });
  ex.active = false; await ex.save();
  res.json({ message: 'Exercise removed' });
};

exports.submit = async (req, res) => {
  try {
    const ex = await Exercise.findById(req.params.id);
    if (!ex) return res.status(404).json({ message: 'Exercise not found' });
    const { completed, driveLink } = req.body;
    if (completed && (!driveLink || !driveLink.trim())) {
      return res.status(400).json({ message: 'Please paste your Google Drive link to mark complete' });
    }
    const sub = await ExerciseSubmission.findOneAndUpdate(
      { exercise: ex._id, employee: req.user._id },
      { completed: !!completed, driveLink: (driveLink || '').trim(), submittedAt: completed ? new Date() : null },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (completed) bumpStreak(req.user._id);
    res.json({ submission: sub });
  } catch (e) {  res.status(500).json({ message: 'Could not save submission' }); }
};

exports.submissionsFor = async (req, res) => {
  const subs = await ExerciseSubmission.find({ exercise: req.params.id }).populate('employee', 'name employeeCode');
  res.json({ submissions: subs });
};
