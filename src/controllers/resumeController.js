const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Resume = require('../models/Resume');
const User = require('../models/User');
const cloudinary = require('../config/cloudinary');
const { logAudit } = require('../utils/audit');
const { inScope } = require('../utils/scope');

const RESUME_EXT = ['.pdf', '.doc', '.docx'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const strList = (v, maxItems = 40, maxLen = 120) => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const s = str(String(item == null ? '' : item), maxLen);
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out.slice(0, maxItems);
};

const lines = (v, maxItems = 12, maxLen = 400) => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
  return arr
    .map((x) => str(String(x == null ? '' : x), maxLen).replace(/^[•\-*]\s*/, ''))
    .filter(Boolean)
    .slice(0, maxItems);
};

const hasContent = (obj) =>
  Object.entries(obj).some(([k, val]) => k !== 'current' && (Array.isArray(val) ? val.length : !!val));

const objList = (v, maxItems, mapper) =>
  (Array.isArray(v) ? v : [])
    .slice(0, maxItems)
    .map((x) => mapper(x && typeof x === 'object' ? x : {}))
    .filter(hasContent);

function clean(body = {}) {
  return {
    fullName: str(body.fullName, 120),
    headline: str(body.headline, 160),
    email: str(body.email, 160),
    phone: str(body.phone, 40),
    location: str(body.location, 120),
    linkedin: str(body.linkedin, 300),
    github: str(body.github, 300),
    portfolio: str(body.portfolio, 300),
    totalExperience: str(body.totalExperience, 60),
    summary: str(body.summary, 2000),
    technicalSkills: strList(body.technicalSkills),
    tools: strList(body.tools),
    softSkills: strList(body.softSkills, 20),
    experience: objList(body.experience, 15, (e) => ({
      company: str(e.company, 160),
      role: str(e.role, 160),
      location: str(e.location, 120),
      start: str(e.start, 30),
      end: e.current ? '' : str(e.end, 30),
      current: !!e.current,
      bullets: lines(e.bullets),
    })),
    projects: objList(body.projects, 15, (p) => ({
      title: str(p.title, 160),
      role: str(p.role, 120),
      tech: str(p.tech, 300),
      link: str(p.link, 300),
      bullets: lines(p.bullets, 8),
    })),
    education: objList(body.education, 8, (e) => ({
      degree: str(e.degree, 160),
      institution: str(e.institution, 200),
      location: str(e.location, 120),
      year: str(e.year, 30),
      score: str(e.score, 40),
    })),
    certifications: objList(body.certifications, 20, (c) => ({
      name: str(c.name, 200),
      issuer: str(c.issuer, 160),
      year: str(c.year, 30),
      link: str(c.link, 300),
    })),
    achievements: lines(body.achievements, 15),
    languages: strList(body.languages, 10, 60),
  };
}

function defaultsFor(user) {
  return {
    fullName: user.name || '',
    headline: '',
    email: user.email || '',
    phone: user.contactNumber || '',
    location: user.preferredLocation || '',
    linkedin: '',
    github: '',
    portfolio: '',
    totalExperience: '',
    summary: '',
    technicalSkills: user.skills || [],
    tools: [],
    softSkills: [],
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    achievements: [],
    languages: [],
  };
}

function shape(resume, user) {
  if (!resume) return { ...defaultsFor(user), file: { url: null, name: '', uploadedAt: null }, exists: false, updatedAt: null };
  const r = resume.toObject ? resume.toObject() : resume;
  const { _id, __v, user: _u, file, createdAt, ...rest } = r;
  return {
    ...rest,
    file: { url: (file && file.url) || null, name: (file && file.name) || '', uploadedAt: (file && file.uploadedAt) || null },
    exists: true,
  };
}

function canView(viewer, employee) {
  if (!employee) return false;
  if (viewer.role === 'admin' || viewer.role === 'cto') return true;
  if (String(viewer._id) === String(employee._id)) return true;
  if (viewer.role === 'bu') return inScope(viewer, employee.businessUnit);
  if (viewer.role === 'manager') {
    return (
      String(employee.manager) === String(viewer._id) ||
      (!!viewer.businessUnit && String(employee.businessUnit) === String(viewer.businessUnit))
    );
  }
  return false;
}

exports.getMine = async (req, res) => {
  const resume = await Resume.findOne({ user: req.user._id });
  res.json({ resume: shape(resume, req.user) });
};

exports.saveMine = async (req, res) => {
  const data = clean(req.body);
  if (!data.fullName) data.fullName = req.user.name;
  const resume = await Resume.findOneAndUpdate(
    { user: req.user._id },
    { $set: data, $setOnInsert: { user: req.user._id } },
    { new: true, upsert: true }
  );

  const skills = strList([...data.technicalSkills, ...data.tools], 60);
  const update = {};
  if (skills.length) update.skills = skills;
  if (data.phone) update.contactNumber = data.phone;
  if (Object.keys(update).length) await User.updateOne({ _id: req.user._id }, { $set: update });

  await logAudit(req, { action: 'update', entity: 'resume', entityId: resume._id, entityLabel: req.user.name });
  res.json({ resume: shape(resume, req.user), message: 'Resume saved' });
};

exports.uploadFile = async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Please choose a file' });
  const cleanup = () => {
    try {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (e) {}
  };
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!RESUME_EXT.includes(ext)) {
    cleanup();
    return res.status(400).json({ message: 'Only PDF, DOC or DOCX files are allowed' });
  }
  if (file.size > MAX_FILE_BYTES) {
    cleanup();
    return res.status(400).json({ message: 'Resume must be 5 MB or smaller' });
  }

  try {
    const up = await cloudinary.uploader.upload(file.path, {
      resource_type: 'raw',
      folder: 'resumes',
      use_filename: true,
      unique_filename: true,
    });
    const existing = await Resume.findOne({ user: req.user._id });
    const oldPublicId = existing && existing.file ? existing.file.publicId : null;
    const resume = await Resume.findOneAndUpdate(
      { user: req.user._id },
      {
        $set: { file: { url: up.secure_url, publicId: up.public_id, name: file.originalname, uploadedAt: new Date() } },
        $setOnInsert: { user: req.user._id, ...defaultsFor(req.user) },
      },
      { new: true, upsert: true }
    );
    if (oldPublicId && oldPublicId !== up.public_id) {
      cloudinary.uploader.destroy(oldPublicId, { resource_type: 'raw' }).catch(() => {});
    }
    await logAudit(req, { action: 'upload', entity: 'resume', entityId: resume._id, entityLabel: file.originalname });
    res.json({ resume: shape(resume, req.user), message: 'Resume uploaded' });
  } finally {
    cleanup();
  }
};

exports.deleteFile = async (req, res) => {
  const resume = await Resume.findOne({ user: req.user._id });
  if (!resume || !resume.file || !resume.file.url) return res.status(404).json({ message: 'No uploaded resume' });
  const publicId = resume.file.publicId;
  resume.file = { url: null, publicId: null, name: '', uploadedAt: null };
  await resume.save();
  if (publicId) cloudinary.uploader.destroy(publicId, { resource_type: 'raw' }).catch(() => {});
  res.json({ resume: shape(resume, req.user), message: 'Uploaded resume removed' });
};

exports.getForUser = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) return res.status(404).json({ message: 'Not found' });
  const employee = await User.findById(req.params.userId);
  if (!employee || !canView(req.user, employee)) return res.status(404).json({ message: 'Not found' });
  const resume = await Resume.findOne({ user: employee._id });
  res.json({
    resume: shape(resume, employee),
    user: { id: employee._id, name: employee.name, email: employee.email, employeeCode: employee.employeeCode },
  });
};
