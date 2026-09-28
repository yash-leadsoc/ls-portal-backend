const cloudinary = require('../config/cloudinary');
const { formatDateTime } = require('../utils/time');
const escapeRegex = require('../utils/escapeRegex');
const Company = require('../models/Company');
const InterviewMaterial = require('../models/InterviewMaterial');
const MockInterview = require('../models/MockInterview');
const ClientInterview = require('../models/ClientInterview');
const Availability = require('../models/Availability');
const InterviewHistory = require('../models/InterviewHistory');
const User = require('../models/User');
const { createMeet } = require('../utils/googleMeet');
const { buOf, seesAll } = require('../utils/scope');
const {
  createNotification,
} = require('../services/pushNotification');
async function pushHistory(entry) {
  try { await InterviewHistory.create(entry); } catch (e) {  }
}

exports.listMaterials = async (req, res) => {
  const q = { active: true };
  if (req.query.company) q.company = req.query.company;
  if (req.query.category) q.category = req.query.category;
  const mats = await InterviewMaterial.find(q)
    .populate('company', 'name')
    .populate('category', 'name')
    .sort({ createdAt: -1 });
  res.json({
    materials: mats.map((m) => ({
      _id: m._id, title: m.title, kind: m.kind, forRole: m.forRole,
      company: m.company?._id, companyName: m.company?.name,
      category: m.category?._id || null,
      categoryName: m.category?.name || null,
      fileUrl: m.fileUrl, originalName: m.originalName, mimeType: m.mimeType,
      uploadedBy: m.uploadedBy, uploaderName: m.uploaderName,
      uploaderEmployeeCode: m.uploaderEmployeeCode, uploaderRole: m.uploaderRole,
      createdAt: m.createdAt,
    })),
  });
};

exports.uploadMaterial = async (req, res) => {
  try {
    const { companyId, title, kind, forRole } = req.body;
    if (!companyId) return res.status(400).json({ message: 'Company is required' });
    if (!title || !title.trim()) return res.status(400).json({ message: 'Title is required' });
    if (!req.file) return res.status(400).json({ message: 'A file is required' });

    const company = await Company.findById(companyId);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const uploaded = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'auto',
      folder: 'interview_materials',
      use_filename: true,
      unique_filename: true,
    });

    let category = company.category || null;
    if (req.user.role === 'bu') {
      category = req.user.category || category;
    } else if (req.user.role === 'manager' || req.user.role === 'employee') {
      const bu = req.user.businessUnit
        ? await User.findById(req.user.businessUnit).select('category')
        : null;
      category = bu?.category || category;
    }

    const mat = await InterviewMaterial.create({
      company: company._id,
      category,
      title: title.trim(),
      kind: kind || 'question_bank',
      forRole: forRole || '',
      fileUrl: uploaded.secure_url,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id,
      uploaderName: req.user.name,
      uploaderEmployeeCode: req.user.employeeCode || '',
      uploaderRole: req.user.role,
    });
    res.status(201).json({ material: mat });
  } catch (e) {
    res.status(500).json({ message: 'Could not upload material' });
  }
};

exports.deleteMaterial = async (req, res) => {
  const m = await InterviewMaterial.findById(req.params.id);
  if (!m) return res.status(404).json({ message: 'Material not found' });
  m.active = false; await m.save();
  res.json({ message: 'Material removed' });
};

exports.listMocks = async (req, res) => {
  const q = {};
  if (req.query.employee) q.employee = req.query.employee;
  if (!seesAll(req.user)) {
    if (req.user.role === 'employee') q.employee = req.user._id;
    else q.businessUnit = buOf(req.user);
  }
  const mocks = await MockInterview.find(q)
    .populate('employee', 'name employeeCode')
    .populate('scheduledBy', 'name')
    .sort({ scheduledAt: -1 });
  res.json({ mocks });
};

exports.scheduleMock = async (req, res) => {
  try {
    const { employeeId, forRole, scheduledAt, durationMins, meetLink } = req.body;
    if (!employeeId || !scheduledAt) return res.status(400).json({ message: 'Employee and time are required' });

    const employee = await User.findById(employeeId);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const start = new Date(scheduledAt);
    const end = new Date(start.getTime() + (Number(durationMins) || 45) * 60000);

    let link = meetLink || null;
    let eventId = null;
    const meet = await createMeet({
      summary: `Mock interview — ${employee.name}${forRole ? ` (${forRole})` : ''}`,
      description: 'Scheduled from LeadSoC training portal',
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      attendees: [employee.email].filter(Boolean),
    });
    if (meet.meetLink) { link = meet.meetLink; eventId = meet.eventId; }

    const mock = await MockInterview.create({
      employee: employee._id,
      forRole: forRole || '',
      scheduledBy: req.user._id,
      scheduledAt: start,
      durationMins: Number(durationMins) || 45,
      meetLink: link,
      meetEventId: eventId,
      businessUnit: buOf(req.user) || employee.businessUnit || null,
    });

    await pushHistory({
      employee: employee._id, type: 'mock',
      title: `Mock scheduled${forRole ? ` — ${forRole}` : ''}`,
      detail: `on ${start.toLocaleString()}`,
      meta: { mockId: mock._id, meetLink: link },
      by: req.user._id, byName: req.user.name, businessUnit: mock.businessUnit,
    });

    await createNotification({
      userId: employee._id,

      type: 'MOCK_INTERVIEW_SCHEDULED',

      title: 'Mock Interview Scheduled',

      body: `Your mock interview is scheduled for ${formatDateTime(start)}${forRole ? ` for ${forRole}` : ''}.`,

      url: '/interviews',
    });

    res.status(201).json({ mock, meetConfigured: meet.configured !== false });
  } catch (e) {
    res.status(500).json({ message: 'Could not schedule mock interview' });
  }
};

exports.scoreMock = async (req, res) => {
  const mock = await MockInterview.findById(req.params.id).populate('employee', 'name');
  if (!mock) return res.status(404).json({ message: 'Mock not found' });
  const { score, review, status } = req.body;
  if (score != null) mock.score = Math.max(0, Math.min(10, Number(score)));
  if (review != null) mock.review = review;
  mock.status = status || 'completed';
  await mock.save();

  await pushHistory({
    employee: mock.employee._id, type: 'mock',
    title: `Mock ${mock.status} — scored ${mock.score ?? '-'}/10`,
    detail: mock.review || '',
    meta: { mockId: mock._id, score: mock.score },
    by: req.user._id, byName: req.user.name, businessUnit: mock.businessUnit,
  });
  res.json({ mock });
};

exports.listClients = async (req, res) => {
  const q = {};
  if (req.query.employee) q.employee = req.query.employee;
  if (!seesAll(req.user)) q.businessUnit = buOf(req.user);
  const items = await ClientInterview.find(q).populate('employee', 'name employeeCode').sort({ sentAt: -1 });
  res.json({ clients: items });
};

exports.createClient = async (req, res) => {
  const { employeeId, client, role, sentAt, status, performance } = req.body;
  if (!employeeId || !client) return res.status(400).json({ message: 'Employee and client are required' });
  const employee = await User.findById(employeeId);
  if (!employee) return res.status(404).json({ message: 'Employee not found' });

  const item = await ClientInterview.create({
    employee: employee._id, client: client.trim(), role: role || '',
    sentAt: sentAt ? new Date(sentAt) : new Date(),
    status: status || 'sent', performance: performance || '',
    businessUnit: buOf(req.user) || employee.businessUnit || null,
    updatedBy: req.user._id,
  });
  await pushHistory({
    employee: employee._id, type: 'client',
    title: `Sent to ${item.client}${role ? ` (${role})` : ''}`,
    detail: [`status: ${item.status}`, item.performance && `performance: ${item.performance}`].filter(Boolean).join(' · '),
    meta: { clientId: item._id },
    by: req.user._id, byName: req.user.name, businessUnit: item.businessUnit,
  });
  res.status(201).json({ client: item });
};

exports.updateClient = async (req, res) => {
  const item = await ClientInterview.findById(req.params.id).populate('employee', 'name');
  if (!item) return res.status(404).json({ message: 'Not found' });
  const { status, performance, note } = req.body;
  if (status) item.status = status;
  if (performance != null) item.performance = performance;
  if (note && note.trim()) {
    item.updates.push({ note: note.trim(), by: req.user._id, byName: req.user.name });
  }
  item.updatedBy = req.user._id;
  await item.save();
  await pushHistory({
    employee: item.employee._id, type: 'status',
    title: `Client update — ${item.client}`,
    detail: [
      status && `status: ${status}`,
      (performance != null && performance !== '') && `performance: ${performance}`,
      note,
    ].filter(Boolean).join(' · '),
    meta: { clientId: item._id }, by: req.user._id, byName: req.user.name, businessUnit: item.businessUnit,
  });
  res.json({ client: item });
};

exports.listAvailability = async (req, res) => {
  const q = {};
  if (req.query.employee) q.employee = req.query.employee;
  else if (req.user.role === 'employee') q.employee = req.user._id;
  else if (!seesAll(req.user)) q.businessUnit = buOf(req.user);
  if (req.query.month) q.date = { $regex: `^${escapeRegex(req.query.month)}` };
  const slots = await Availability.find(q).sort({ date: 1, fromTime: 1 });
  res.json({ availability: slots });
};

exports.addAvailability = async (req, res) => {
  const { date, fromTime, toTime, note } = req.body;
  if (!date) return res.status(400).json({ message: 'Date is required' });
  const slot = await Availability.create({
    employee: req.user._id, date, fromTime: fromTime || '', toTime: toTime || '', note: note || '',
    businessUnit: req.user.businessUnit || null,
  });
  await pushHistory({
    employee: req.user._id, type: 'availability',
    title: `Marked available ${date}${fromTime ? ` ${fromTime}-${toTime}` : ''}`,
    by: req.user._id, byName: req.user.name, businessUnit: req.user.businessUnit || null,
  });
  res.status(201).json({ slot });
};

exports.deleteAvailability = async (req, res) => {
  const slot = await Availability.findById(req.params.id);
  if (!slot) return res.status(404).json({ message: 'Not found' });
  if (String(slot.employee) !== String(req.user._id) && !seesAll(req.user)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  await slot.deleteOne();
  res.json({ message: 'Removed' });
};

exports.employeeHistory = async (req, res) => {
  const rows = await InterviewHistory.find({ employee: req.params.employeeId }).sort({ at: -1 }).limit(500);
  res.json({ history: rows });
};
