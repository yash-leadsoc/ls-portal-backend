const mongoose = require('mongoose');
const User = require('../models/User');
const Domain = require('../models/Domain');
const { buOf, seesAll, buFilter, inScope, writeBU } = require('../utils/scope');
const { logAudit } = require('../utils/audit');
const { benchInfo, parseDate } = require('../utils/bench');

const JOB_STATUSES = ['on_training', 'ongoing_interview', 'deployed'];

const {
  createNotification,
} = require('../services/pushNotification');

function genCode(role) {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return role === 'manager' ? `LS-MGR-${rand}` : `LS-${rand}`;
}

exports.createCTO = async (req, res) => {
  try {
    const { name, email, password, employeeCode } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'name, email and password are required' });
    if (!employeeCode || !employeeCode.trim()) return res.status(400).json({ message: 'CTO ID is required' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'A user with this email already exists' });
    const codeExists = await User.findOne({ employeeCode: employeeCode.trim() });
    if (codeExists) return res.status(409).json({ message: 'A user with this ID already exists' });
    const user = new User({
      name, email: email.toLowerCase(), employeeCode: employeeCode.trim(),
      role: 'cto', createdBy: req.user._id,
    });
    await user.setPassword(password);
    await user.save();
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {  res.status(500).json({ message: 'Could not create CTO' }); }
};

exports.createSubAdmin = async (req, res) => {
  try {
    const { name, email, password, employeeCode } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'name, email and password are required' });
    if (String(password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    if (!employeeCode || !String(employeeCode).trim()) return res.status(400).json({ message: 'Sub admin ID is required' });
    const exists = await User.findOne({ email: String(email).toLowerCase() });
    if (exists) return res.status(409).json({ message: 'A user with this email already exists' });
    const codeExists = await User.findOne({ employeeCode: String(employeeCode).trim() });
    if (codeExists) return res.status(409).json({ message: 'A user with this ID already exists' });
    const user = new User({
      name,
      email: String(email).toLowerCase(),
      employeeCode: String(employeeCode).trim(),
      role: 'admin',
      subAdmin: true,
      createdBy: req.user._id,
    });
    await user.setPassword(password);
    await user.save();
    await logAudit(req, { action: 'create', entity: 'subadmin', entityId: user._id, entityLabel: user.name });
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ message: 'Could not create sub admin' });
  }
};

exports.listSubAdmins = async (req, res) => {
  const users = await User.find({ role: 'admin', subAdmin: true }).sort({ name: 1 });
  res.json({ subadmins: users.map((u) => u.toSafeJSON()) });
};

exports.listCTOs = async (req, res) => {
  const ctos = await User.find({ role: 'cto' }).sort({ name: 1 });
  res.json({ ctos: ctos.map((c) => c.toSafeJSON()) });
};

exports.createBU = async (req, res) => {
  try {
    const { name, password, employeeCode, categoryId } = req.body;
    const kind = ['bu', 'unit', 'head'].includes(req.body.kind) ? req.body.kind : 'bu';
    let email = String(req.body.email || '').trim().toLowerCase();

    if (!name || !String(name).trim()) return res.status(400).json({ message: 'Name is required' });
    if (!employeeCode || !String(employeeCode).trim()) return res.status(400).json({ message: 'BU ID is required' });
    if (kind !== 'head' && !categoryId) return res.status(400).json({ message: 'Category is required' });
    if (kind === 'unit') {
      if (!email) email = `unit-${String(employeeCode).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')}@units.leadsoc.local`;
    } else {
      if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
      if (String(password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: 'A user with this email already exists' });
    const codeExists = await User.findOne({ employeeCode: String(employeeCode).trim() });
    if (codeExists) return res.status(409).json({ message: 'A user with this ID already exists' });

    const user = new User({
      name: String(name).trim(),
      email,
      employeeCode: String(employeeCode).trim(),
      role: 'bu',
      category: kind === 'head' ? null : categoryId,
      createdBy: req.user._id,
      loginDisabled: kind === 'unit',
      headOnly: kind === 'head',
    });
    await user.setPassword(kind === 'unit' ? require('crypto').randomBytes(16).toString('hex') : password);
    await user.save();
    await logAudit(req, { action: 'create', entity: kind === 'head' ? 'bu.head' : 'bu', entityId: user._id, entityLabel: user.name });
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ message: 'Could not create BU' });
  }
};

exports.listBUs = async (req, res) => {
  const { headsOf } = require('../utils/units');
  const all = await User.find({ role: 'bu' })
    .populate({ path: 'category', select: 'name parent', populate: { path: 'parent', select: 'name' } })
    .sort({ name: 1 });
  const units = all.filter((b) => !b.headOnly);
  const heads = await headsOf(units.map((u) => u._id));
  res.json({
    bus: units.map((b) => ({
      ...b.toSafeJSON(),
      categoryName: b.category ? (b.category.parent ? `${b.category.parent.name} › ${b.category.name}` : b.category.name) : null,
      isCategoryHead: !!(b.category && !b.category.parent),
      heads: heads.get(String(b._id)) || [],
    })),
    headOnly: all
      .filter((b) => b.headOnly)
      .map((b) => ({ ...b.toSafeJSON(), categoryName: null })),
  });
};
exports.createManager = async (req, res) => {
  try {
    const { name, email, password, employeeCode } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email and password are required' });
    }
    if (!employeeCode || !employeeCode.trim()) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'A user with this email already exists' });
    const codeExists = await User.findOne({ employeeCode: employeeCode.trim() });
    if (codeExists) return res.status(409).json({ message: 'A user with this Employee ID already exists' });

    let businessUnit = null;
    if (req.user.role === 'bu') businessUnit = writeBU(req);
    else if (req.user.role === 'admin') businessUnit = req.body.businessUnit || null;

    const user = new User({
      name,
      email: email.toLowerCase(),
      employeeCode: employeeCode.trim(),
      role: 'manager',
      createdBy: req.user._id,
      businessUnit,
    });
    await user.setPassword(password);
    await user.save();
     await logAudit(req, {
    action: 'create', entity: 'manager',
    entityId: user._id, entityLabel: user.name,
  });
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ message: 'Could not create manager' });
  }
};

exports.createEmployee = async (req, res) => {
  try {
    const { name, email, password, employeeCode, managerId, benchStart, jobStatus } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email and password are required' });
    }
    if (!employeeCode || !employeeCode.trim()) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'A user with this email already exists' });
    const codeExists = await User.findOne({ employeeCode: employeeCode.trim() });
    if (codeExists) return res.status(409).json({ message: 'A user with this Employee ID already exists' });

    const benchDate = parseDate(benchStart);
    if (benchDate === 'invalid') return res.status(400).json({ message: 'Bench start date is not valid' });
    if (benchDate && benchDate.getTime() > Date.now()) {
      return res.status(400).json({ message: 'Bench start date cannot be in the future' });
    }
    const initialStatus = JOB_STATUSES.includes(jobStatus) ? jobStatus : 'on_training';

    let manager = null;
    let businessUnit = null;
    if (req.user.role === 'manager') {
      manager = req.user._id;
      businessUnit = req.user.businessUnit || null;
    } else if (req.user.role === 'bu') {
      businessUnit = writeBU(req);
      manager = managerId || null;
    } else if (req.user.role === 'admin') {
      if (!req.body.businessUnit) return res.status(400).json({ message: 'Please select a Business Unit' });
      const bu = await User.findOne({ _id: req.body.businessUnit, role: 'bu' }).select('_id');
      if (!bu) return res.status(400).json({ message: 'Selected Business Unit was not found' });
      businessUnit = bu._id;
      manager = managerId || null;
    }

    const user = new User({
      name,
      email: email.toLowerCase(),
      employeeCode: employeeCode.trim(),
      role: 'employee',
      createdBy: req.user._id,
      manager,
      businessUnit,
      benchStart: benchDate || new Date(),
      jobStatus: initialStatus,
      deployedAt: initialStatus === 'deployed' ? new Date() : null,
    });
    await user.setPassword(password);
    await user.save();

     await logAudit(req, {
    action: 'create', entity: 'employee',
    entityId: user._id, entityLabel: user.name,
  });
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ message: 'Could not create employee' });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const { role } = req.query;
    let filter = {};

    const roleFilter = (r) => (r === 'manager' ? { $or: [{ role: 'manager' }, { role: 'employee', trainerAccess: true }] } : { role: r });
    if (req.user.role === 'admin' || req.user.role === 'cto') {
      if (role) filter = { ...roleFilter(role) };
    } else if (req.user.role === 'bu') {
      filter = { businessUnit: buFilter(req.user) };
      if (role) filter = { ...filter, ...roleFilter(role) };
    } else if (req.user.role === 'manager') {
      filter = req.user.businessUnit
        ? { role: 'employee', businessUnit: req.user.businessUnit }
        : { role: 'employee', manager: req.user._id };
    } else {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const users = await User.find(filter)
      .populate({ path: 'businessUnit', select: 'name category', populate: { path: 'category', select: 'name' } })
      .populate('manager', 'name')
      .sort({ createdAt: -1 });

    const now = Date.now();
    const rows = users.map((u) => {
      const base = u.toSafeJSON();
      return {
        ...base,
        buName: u.businessUnit?.name || null,
        categoryName: u.businessUnit?.category?.name || null,
        trainerName: u.manager?.name || null,
        ...benchInfo(u),
      };
    });
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ message: 'Could not list users' });
  }
};

exports.listManagers = async (req, res) => {
  const filter = { $or: [{ role: 'manager' }, { role: 'employee', trainerAccess: true }] };
  if (req.user.role === 'bu') filter.businessUnit = buFilter(req.user);
  const managers = await User.find(filter).sort({ name: 1 });
  res.json({ managers: managers.map((m) => m.toSafeJSON()) });
};

exports.getUser = async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate({ path: 'businessUnit', select: 'name category', populate: { path: 'category', select: 'name' } })
    .populate('manager', 'name');
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (req.user.role === 'bu' && !inScope(req.user, user.businessUnit)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  if (
    req.user.role === 'manager' &&
    String(user.businessUnit) !== String(req.user.businessUnit) &&
    String(user.manager) !== String(req.user._id)
  ) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  res.json({
    user: {
      ...user.toSafeJSON(),
      buName: user.businessUnit?.name || null,
      categoryName: user.businessUnit?.category?.name || null,
      trainerName: user.manager?.name || null,
      ...benchInfo(user),
      streak: user.streak || { current: 0, longest: 0 },
    },
  });
};

exports.updateMyMenu = async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    if (!u) return res.status(404).json({ message: 'User not found' });
    const { menuConfig } = req.body;
    u.menuConfig = Array.isArray(menuConfig) ? menuConfig.map(String) : [];
    await u.save();
    res.json({ user: u.toSafeJSON() });
  } catch (e) { res.status(500).json({ message: 'Could not save menu' }); }
};

exports.updateMyProfile = async (req, res) => {
  try {
    const u = await User.findById(req.user._id);
    if (!u) return res.status(404).json({ message: 'User not found' });
    const { preferredLocation, skills, contactNumber } = req.body;
    if (preferredLocation != null) u.preferredLocation = String(preferredLocation).trim().slice(0, 120);
    if (contactNumber != null) {
      const phone = String(contactNumber).trim();
      if (phone && !/^[+\d][\d\s()-]{6,19}$/.test(phone)) {
        return res.status(400).json({ message: 'Enter a valid contact number' });
      }
      u.contactNumber = phone;
    }
    if (skills != null) {
      const list = Array.isArray(skills) ? skills : String(skills).split(',');
      const seen = new Set();
      u.skills = list
        .map((x) => String(x || '').trim().slice(0, 80))
        .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
        .slice(0, 60);
    }
    await u.save();
    res.json({ user: u.toSafeJSON() });
  } catch (e) {
    res.status(500).json({ message: 'Could not update profile' });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u || u.role !== 'employee') return res.status(404).json({ message: 'Engineer not found' });

    const { jobStatus } = req.body;
    if (jobStatus && !JOB_STATUSES.includes(jobStatus)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const benchDate = parseDate(req.body.benchStart);
    const deployedDate = parseDate(req.body.deployedAt);
    if (benchDate === 'invalid' || deployedDate === 'invalid') {
      return res.status(400).json({ message: 'Date is not valid' });
    }
    const now = Date.now();
    if ((benchDate && benchDate.getTime() > now) || (deployedDate && deployedDate.getTime() > now)) {
      return res.status(400).json({ message: 'Dates cannot be in the future' });
    }

    const before = { jobStatus: u.jobStatus, benchStart: u.benchStart, deployedAt: u.deployedAt };
    const wasDeployed = u.jobStatus === 'deployed';
    if (jobStatus) u.jobStatus = jobStatus;
    const isDeployed = u.jobStatus === 'deployed';

    if (isDeployed) {
      if (deployedDate !== undefined) u.deployedAt = deployedDate || new Date();
      else if (!wasDeployed || !u.deployedAt) u.deployedAt = new Date();
    } else if (wasDeployed) {
      u.deployedAt = null;
      if (benchDate === undefined) u.benchStart = new Date();
    }
    if (benchDate !== undefined) u.benchStart = benchDate;

    const start = u.benchStart || u.enrolledAt || u.createdAt;
    if (isDeployed && u.deployedAt && start && u.deployedAt.getTime() < new Date(start).getTime()) {
      return res.status(400).json({ message: 'Deployed date cannot be before the bench start date' });
    }

    await u.save();
    await logAudit(req, {
      action: 'update',
      entity: 'employee.status',
      entityId: u._id,
      entityLabel: u.name,
      meta: { before, after: { jobStatus: u.jobStatus, benchStart: u.benchStart, deployedAt: u.deployedAt } },
    });
    res.json({ user: { ...u.toSafeJSON(), ...benchInfo(u) } });
  } catch (e) {
    res.status(500).json({ message: 'Could not update status' });
  }
};

function canManageUser(me, target) {
  if (!me || !target) return false;
  if (String(me._id) === String(target._id)) return false;
  if (target.role === 'admin') return !!target.subAdmin && me.role === 'admin' && !me.subAdmin;
  if (me.role === 'admin') return true;
  if (me.role === 'bu') {
    return ['manager', 'employee'].includes(target.role) && inScope(me, target.businessUnit);
  }
  if (me.role === 'manager') {
    return (
      target.role === 'employee' &&
      (String(target.manager) === String(me._id) || (!!me.businessUnit && String(target.businessUnit) === String(me.businessUnit)))
    );
  }
  return false;
}

exports.setActive = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (!canManageUser(req.user, user)) return res.status(403).json({ message: 'You are not allowed to change this account' });
  user.active = !!req.body.active;
  await user.save();
  await logAudit(req, {
    action: user.active ? 'activate' : 'deactivate',
    entity: user.role,
    entityId: user._id,
    entityLabel: user.name,
  });
  res.json({ user: user.toSafeJSON() });
};

exports.assignDomains = async (req, res) => {
  try {
    const { domainIds } = req.body;

    if (!Array.isArray(domainIds)) {
      return res.status(400).json({
        message: 'domainIds must be an array',
      });
    }

    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        message: 'Employee not found',
      });
    }

    if (employee.role !== 'employee') {
      return res.status(400).json({
        message:
          'Domains can only be assigned to employees',
      });
    }

    const uniqueDomainIds = [
      ...new Set(domainIds.map((id) => String(id))),
    ];

    const domains = await Domain.find({
      _id: {
        $in: uniqueDomainIds,
      },
    }).select('_id');

    if (domains.length !== uniqueDomainIds.length) {
      return res.status(400).json({
        message: 'One or more domains are invalid',
      });
    }

    employee.assignedDomains = uniqueDomainIds;

    await employee.save();

    const updatedEmployee = await User.findById(
      employee._id
    ).populate(
      'assignedDomains',
      'name icon description'
    );

     await logAudit(req, {
    action: 'assign', entity: 'domain',
    entityId: employee._id, entityLabel: employee.name,
  });

    return res.json({
      message: 'Domains assigned successfully',
      assignedDomains:
        updatedEmployee.assignedDomains || [],
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to assign domains',
    });
  }
};

const MAX_BULK_ROWS = 300;
const BULK_STATUS = {
  'on training': 'on_training',
  on_training: 'on_training',
  training: 'on_training',
  'ongoing interview': 'ongoing_interview',
  ongoing_interview: 'ongoing_interview',
  interview: 'ongoing_interview',
  deployed: 'deployed',
};
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RX = /^[+\d][\d\s()-]{6,19}$/;

const cell = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));

function generatePassword() {
  return `Ls@${require('crypto').randomBytes(4).toString('hex')}`;
}

async function runPool(items, size, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

exports.bulkCreateEmployees = async (req, res) => {
  const input = Array.isArray(req.body.rows) ? req.body.rows : [];
  const dryRun = req.body.dryRun !== false;
  if (!input.length) return res.status(400).json({ message: 'The file has no engineer rows' });
  if (input.length > MAX_BULK_ROWS) {
    return res.status(400).json({ message: `Upload at most ${MAX_BULK_ROWS} engineers per file` });
  }

  let businessUnit = req.user.role === 'bu' ? writeBU(req) : req.user._id;
  if (req.user.role === 'admin') {
    const bu = req.body.businessUnit ? await User.findOne({ _id: req.body.businessUnit, role: 'bu' }).select('_id') : null;
    if (!bu) return res.status(400).json({ message: 'Please select a Business Unit' });
    businessUnit = bu._id;
  }

  const rows = input.map((r, i) => ({
    row: Number(r && r.row) || i + 2,
    name: cell(r && r.name, 120),
    email: cell(r && r.email, 160).toLowerCase(),
    employeeCode: cell(r && r.employeeCode, 40),
    password: cell(r && r.password, 100),
    trainerCode: cell(r && r.trainerCode, 40),
    benchStart: cell(r && r.benchStart, 30),
    status: cell(r && r.status, 40),
    contactNumber: cell(r && r.contactNumber, 30),
    preferredLocation: cell(r && r.preferredLocation, 120),
    skills: cell(r && r.skills, 1000),
  }));

  const [existing, trainers] = await Promise.all([
    User.find({}).select('email employeeCode').lean(),
    User.find({ $or: [{ role: 'manager' }, { role: 'employee', trainerAccess: true }], businessUnit, active: true }).select('employeeCode name').lean(),
  ]);
  const takenEmails = new Set(existing.map((u) => String(u.email || '').toLowerCase()));
  const takenCodes = new Set(existing.map((u) => String(u.employeeCode || '').toLowerCase()).filter(Boolean));
  const trainerByCode = new Map(trainers.map((t) => [String(t.employeeCode || '').toLowerCase(), t]));

  const emailCount = {};
  const codeCount = {};
  rows.forEach((r) => {
    if (r.email) emailCount[r.email] = (emailCount[r.email] || 0) + 1;
    if (r.employeeCode) codeCount[r.employeeCode.toLowerCase()] = (codeCount[r.employeeCode.toLowerCase()] || 0) + 1;
  });

  const today = Date.now();
  const checked = rows.map((r) => {
    const errors = [];
    if (!r.name) errors.push('Full name is required');
    if (!r.email) errors.push('Email is required');
    else if (!EMAIL_RX.test(r.email)) errors.push('Email is not valid');
    else if (emailCount[r.email] > 1) errors.push('Email appears more than once in the file');
    else if (takenEmails.has(r.email)) errors.push('Email is already registered');
    if (!r.employeeCode) errors.push('Employee ID is required');
    else if (codeCount[r.employeeCode.toLowerCase()] > 1) errors.push('Employee ID appears more than once in the file');
    else if (takenCodes.has(r.employeeCode.toLowerCase())) errors.push('Employee ID is already registered');
    if (r.password && r.password.length < 6) errors.push('Password must be at least 6 characters');

    let manager = null;
    if (r.trainerCode) {
      const t = trainerByCode.get(r.trainerCode.toLowerCase());
      if (!t) errors.push(`Trainer "${r.trainerCode}" not found in your unit`);
      else manager = t._id;
    }

    let benchDate = null;
    if (r.benchStart) {
      const d = parseDate(r.benchStart);
      if (d === 'invalid' || !d) errors.push('Bench start date is not valid (use YYYY-MM-DD)');
      else if (d.getTime() > today) errors.push('Bench start date cannot be in the future');
      else benchDate = d;
    }

    let jobStatus = 'on_training';
    if (r.status) {
      const s = BULK_STATUS[r.status.toLowerCase()];
      if (!s) errors.push('Status must be On training, Ongoing interview or Deployed');
      else jobStatus = s;
    }

    if (r.contactNumber && !PHONE_RX.test(r.contactNumber)) errors.push('Contact number is not valid');

    const seen = new Set();
    const skills = r.skills
      .split(',')
      .map((x) => x.trim().slice(0, 80))
      .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
      .slice(0, 60);

    return { ...r, errors, manager, benchDate, jobStatus, skillsList: skills };
  });

  const summary = (list) =>
    list.map((r) => ({
      row: r.row,
      name: r.name,
      email: r.email,
      employeeCode: r.employeeCode,
      status: r.result || (r.errors.length ? 'invalid' : 'valid'),
      errors: r.errors,
      password: r.generatedPassword || undefined,
    }));

  const valid = checked.filter((r) => !r.errors.length);
  if (dryRun) {
    return res.json({ dryRun: true, total: checked.length, valid: valid.length, invalid: checked.length - valid.length, results: summary(checked) });
  }

  await runPool(valid, 5, async (r) => {
    try {
      const password = r.password || generatePassword();
      const user = new User({
        name: r.name,
        email: r.email,
        employeeCode: r.employeeCode,
        role: 'employee',
        createdBy: req.user._id,
        manager: r.manager,
        businessUnit,
        benchStart: r.benchDate || new Date(),
        jobStatus: r.jobStatus,
        deployedAt: r.jobStatus === 'deployed' ? new Date() : null,
        contactNumber: r.contactNumber,
        preferredLocation: r.preferredLocation,
        skills: r.skillsList,
      });
      await user.setPassword(password);
      await user.save();
      r.result = 'created';
      r.generatedPassword = r.password ? '(as entered in file)' : password;
    } catch (e) {
      r.result = 'failed';
      r.errors.push(e && e.code === 11000 ? 'Email or Employee ID is already registered' : 'Could not create this engineer');
    }
  });

  const created = checked.filter((r) => r.result === 'created').length;
  await logAudit(req, {
    action: 'create',
    entity: 'employee.bulk',
    entityLabel: `${created} engineer(s) via Excel upload`,
    meta: { total: checked.length, created, skipped: checked.length - created },
  });

  res.status(created ? 201 : 200).json({
    dryRun: false,
    total: checked.length,
    created,
    skipped: checked.length - created,
    results: summary(checked),
  });
};

exports.updateTrainer = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Trainer not found' });
    const trainer = await User.findById(req.params.id);
    if (!trainer || (trainer.role !== 'manager' && !(trainer.role === 'employee' && trainer.trainerAccess))) return res.status(404).json({ message: 'Trainer not found' });
    if (req.user.role === 'bu' && !inScope(req.user, trainer.businessUnit)) {
      return res.status(403).json({ message: 'You can only edit trainers in your unit' });
    }

    const { name, email, employeeCode, contactNumber, businessUnit, domainIds } = req.body || {};

    if (name !== undefined) {
      const v = String(name).trim();
      if (!v) return res.status(400).json({ message: 'Name is required' });
      trainer.name = v.slice(0, 120);
    }
    if (email !== undefined) {
      const v = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return res.status(400).json({ message: 'Enter a valid email' });
      if (v !== trainer.email) {
        const taken = await User.findOne({ email: v, _id: { $ne: trainer._id } }).select('_id');
        if (taken) return res.status(409).json({ message: 'A user with this email already exists' });
        trainer.email = v;
      }
    }
    if (employeeCode !== undefined) {
      const v = String(employeeCode).trim();
      if (!v) return res.status(400).json({ message: 'Employee ID is required' });
      if (v !== trainer.employeeCode) {
        const taken = await User.findOne({ employeeCode: v, _id: { $ne: trainer._id } }).select('_id');
        if (taken) return res.status(409).json({ message: 'A user with this ID already exists' });
        trainer.employeeCode = v.slice(0, 40);
      }
    }
    if (contactNumber !== undefined) trainer.contactNumber = String(contactNumber).trim().slice(0, 30);
    if (businessUnit !== undefined && (req.user.role === 'admin' || (req.user.role === 'bu' && inScope(req.user, businessUnit)))) {
      const bu = mongoose.isValidObjectId(businessUnit) ? await User.findOne({ _id: businessUnit, role: 'bu' }).select('_id') : null;
      if (!bu) return res.status(400).json({ message: 'Select a valid Business Unit' });
      trainer.businessUnit = bu._id;
    }
    if (domainIds !== undefined) {
      if (!Array.isArray(domainIds)) return res.status(400).json({ message: 'domainIds must be an array' });
      const ids = [...new Set(domainIds.map(String))];
      if (ids.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'One or more domains are invalid' });
      const found = await Domain.find({ _id: { $in: ids }, active: true }).select('_id');
      if (found.length !== ids.length) return res.status(400).json({ message: 'One or more domains are invalid' });
      trainer.trainerDomains = ids;
    }

    await trainer.save();
    await logAudit(req, { action: 'update', entity: 'trainer', entityId: trainer._id, entityLabel: trainer.name });

    const fresh = await User.findById(trainer._id).populate({ path: 'businessUnit', select: 'name category', populate: { path: 'category', select: 'name' } });
    res.json({
      user: {
        ...fresh.toSafeJSON(),
        buName: fresh.businessUnit?.name || null,
        categoryName: fresh.businessUnit?.category?.name || null,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Could not update trainer' });
  }
};

exports.updateEngineer = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Engineer not found' });
    const eng = await User.findById(req.params.id);
    if (!eng || eng.role !== 'employee') return res.status(404).json({ message: 'Engineer not found' });

    const me = req.user;
    const sameUnit =
      (me.role === 'bu' && inScope(me, eng.businessUnit)) ||
      (me.role === 'manager' &&
        (String(eng.manager) === String(me._id) || (!!me.businessUnit && String(eng.businessUnit) === String(me.businessUnit))));
    if (me.role !== 'admin' && !sameUnit) return res.status(403).json({ message: 'You can only edit engineers in your unit' });

    const { name, email, employeeCode, contactNumber, preferredLocation, skills, businessUnit, managerId } = req.body || {};

    if (name !== undefined) {
      const v = String(name).trim();
      if (!v) return res.status(400).json({ message: 'Name is required' });
      eng.name = v.slice(0, 120);
    }
    if (email !== undefined) {
      const v = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return res.status(400).json({ message: 'Enter a valid email' });
      if (v !== eng.email) {
        const taken = await User.findOne({ email: v, _id: { $ne: eng._id } }).select('_id');
        if (taken) return res.status(409).json({ message: 'A user with this email already exists' });
        eng.email = v;
      }
    }
    if (employeeCode !== undefined) {
      const v = String(employeeCode).trim();
      if (!v) return res.status(400).json({ message: 'Employee ID is required' });
      if (v !== eng.employeeCode) {
        const taken = await User.findOne({ employeeCode: v, _id: { $ne: eng._id } }).select('_id');
        if (taken) return res.status(409).json({ message: 'A user with this ID already exists' });
        eng.employeeCode = v.slice(0, 40);
      }
    }
    if (contactNumber !== undefined) {
      const v = String(contactNumber).trim();
      if (v && !/^[+\d][\d\s()-]{6,19}$/.test(v)) return res.status(400).json({ message: 'Enter a valid contact number' });
      eng.contactNumber = v;
    }
    if (preferredLocation !== undefined) eng.preferredLocation = String(preferredLocation).trim().slice(0, 120);
    if (skills !== undefined) {
      const listIn = Array.isArray(skills) ? skills : String(skills).split(',');
      const seen = new Set();
      eng.skills = listIn
        .map((x) => String(x || '').trim().slice(0, 80))
        .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
        .slice(0, 60);
    }

    if (businessUnit !== undefined && (me.role === 'admin' || (me.role === 'bu' && inScope(me, businessUnit)))) {
      const bu = mongoose.isValidObjectId(businessUnit) ? await User.findOne({ _id: businessUnit, role: 'bu' }).select('_id') : null;
      if (!bu) return res.status(400).json({ message: 'Select a valid Business Unit' });
      if (String(eng.businessUnit) !== String(bu._id)) {
        eng.businessUnit = bu._id;
        if (managerId === undefined) eng.manager = null;
      }
    }

    if (managerId !== undefined && me.role !== 'manager') {
      if (!managerId) {
        eng.manager = null;
      } else {
        const trainer = mongoose.isValidObjectId(managerId)
          ? await User.findOne({ _id: managerId, active: true, $or: [{ role: 'manager' }, { role: 'employee', trainerAccess: true }] }).select('_id businessUnit')
          : null;
        if (!trainer) return res.status(400).json({ message: 'Select a valid trainer' });
        if (eng.businessUnit && String(trainer.businessUnit) !== String(eng.businessUnit)) {
          return res.status(400).json({ message: 'The trainer must belong to the same Business Unit as the engineer' });
        }
        eng.manager = trainer._id;
      }
    }

    await eng.save();
    await logAudit(req, { action: 'update', entity: 'employee', entityId: eng._id, entityLabel: eng.name });

    const fresh = await User.findById(eng._id)
      .populate({ path: 'businessUnit', select: 'name category', populate: { path: 'category', select: 'name' } })
      .populate('manager', 'name');
    res.json({
      user: {
        ...fresh.toSafeJSON(),
        buName: fresh.businessUnit?.name || null,
        categoryName: fresh.businessUnit?.category?.name || null,
        trainerName: fresh.manager?.name || null,
        ...benchInfo(fresh),
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Could not update engineer' });
  }
};


exports.listBUHeads = async (req, res) => {
  const people = await User.find({ role: 'bu', active: true, loginDisabled: { $ne: true } })
    .populate('category', 'name')
    .sort({ name: 1 });
  res.json({
    heads: people.map((p) => ({
      id: p._id,
      name: p.name,
      email: p.email,
      employeeCode: p.employeeCode,
      headOnly: !!p.headOnly,
      categoryName: p.category?.name || null,
    })),
  });
};

exports.addUnitHead = async (req, res) => {
  const { headId } = req.body || {};
  const type = req.body.type === 'temporary' ? 'temporary' : 'permanent';
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(headId)) {
    return res.status(400).json({ message: 'Select a valid BU and BU head' });
  }
  if (String(req.params.id) === String(headId)) return res.status(400).json({ message: 'A BU is already the head of its own category' });
  const unit = await User.findOne({ _id: req.params.id, role: 'bu', headOnly: { $ne: true } });
  if (!unit) return res.status(404).json({ message: 'BU not found' });
  const head = await User.findOne({ _id: headId, role: 'bu', active: true });
  if (!head) return res.status(404).json({ message: 'BU head not found' });
  if (head.loginDisabled) return res.status(400).json({ message: 'This account has login disabled and cannot be a head' });

  const existing = (head.unitAccess || []).find((a) => String(a.unit) === String(unit._id));
  if (existing) existing.type = type;
  else head.unitAccess.push({ unit: unit._id, type, since: new Date() });
  await head.save();
  await logAudit(req, {
    action: 'assign',
    entity: 'bu.head',
    entityId: unit._id,
    entityLabel: `${head.name} → ${unit.name} (${type})`,
  });
  res.json({ message: `${head.name} is now a ${type} head of ${unit.name}` });
};

exports.removeUnitHead = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.headId)) {
    return res.status(400).json({ message: 'Invalid request' });
  }
  const head = await User.findOne({ _id: req.params.headId, role: 'bu' });
  if (!head) return res.status(404).json({ message: 'BU head not found' });
  const before = (head.unitAccess || []).length;
  head.unitAccess = (head.unitAccess || []).filter((a) => String(a.unit) !== String(req.params.id));
  if (head.unitAccess.length === before) return res.status(404).json({ message: 'This person is not a head of that BU' });
  await head.save();
  const unit = await User.findById(req.params.id).select('name');
  await logAudit(req, { action: 'remove', entity: 'bu.head', entityId: req.params.id, entityLabel: `${head.name} ✕ ${unit ? unit.name : ''}` });
  res.json({ message: 'Head removed' });
};

exports.setUnitLogin = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'BU not found' });
  const unit = await User.findOne({ _id: req.params.id, role: 'bu' });
  if (!unit) return res.status(404).json({ message: 'BU not found' });
  unit.loginDisabled = !!req.body.loginDisabled;
  await unit.save();
  await logAudit(req, {
    action: 'update',
    entity: 'bu.login',
    entityId: unit._id,
    entityLabel: `${unit.name}: login ${unit.loginDisabled ? 'disabled' : 'enabled'}`,
  });
  res.json({ user: unit.toSafeJSON() });
};


exports.deleteUser = async (req, res) => {
  const { moveToTrash } = require('../utils/trash');
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (req.user.role === 'manager' || !canManageUser(req.user, user)) {
    return res.status(403).json({ message: 'You are not allowed to delete this account' });
  }

  if (user.role === 'bu' && !user.headOnly) {
    const [engineers, trainers, domains] = await Promise.all([
      User.countDocuments({ role: 'employee', businessUnit: user._id }),
      User.countDocuments({ role: 'manager', businessUnit: user._id }),
      Domain.countDocuments({ businessUnit: user._id, active: true }),
    ]);
    if (engineers || trainers || domains) {
      return res.status(409).json({
        message: `This BU still has ${engineers} engineer(s), ${trainers} trainer(s) and ${domains} domain(s). Move them to another BU first, or deactivate the BU instead.`,
      });
    }
    await User.updateMany({ 'unitAccess.unit': user._id }, { $pull: { unitAccess: { unit: user._id } } });
  }

  let unassigned = 0;
  if (user.role === 'manager') {
    const r = await User.updateMany({ role: 'employee', manager: user._id }, { $set: { manager: null } });
    unassigned = r.modifiedCount || 0;
  }

  const roleLabel = { employee: 'Engineer', manager: 'Trainer', bu: 'BU', cto: 'CTO', admin: 'Sub admin' }[user.role] || 'User';
  await moveToTrash(req, {
    entity: 'user',
    label: `${roleLabel}: ${user.name} (${user.employeeCode || user.email})`,
    docs: [{ model: 'User', doc: user }],
  });
  try {
    await require('../models/PushSubscription').deleteMany({ user: user._id });
  } catch (e) {}

  res.json({
    message:
      `${roleLabel} moved to the Recycle Bin. An admin can restore it within 30 days.` +
      (unassigned ? ` ${unassigned} engineer(s) no longer have a trainer.` : ''),
  });
};


exports.myScope = async (req, res) => {
  const u = req.user;
  if (u.role !== 'bu') return res.json({ isCategoryHead: false, units: [] });
  const ids = (u.$locals && u.$locals.buScope) || [u._id];
  const units = await User.find({ _id: { $in: ids } }).populate('category', 'name parent').select('name category');
  res.json({
    isCategoryHead: !!(u.$locals && u.$locals.isCategoryHead),
    activeUnit: { id: u._id, name: u.name },
    units: units.map((x) => ({
      id: x._id,
      name: x.name,
      categoryName: x.category?.name || null,
      level: String(x._id) === String(u._id) ? 'category' : 'sub',
    })),
  });
};


exports.setTrainerAccess = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Engineer not found' });
  const eng = await User.findById(req.params.id);
  if (!eng || eng.role !== 'employee') return res.status(404).json({ message: 'Engineer not found' });
  if (!['admin', 'bu'].includes(req.user.role) || !canManageUser(req.user, eng)) {
    return res.status(403).json({ message: 'You are not allowed to change this engineer' });
  }
  const enabled = !!req.body.enabled;
  eng.trainerAccess = enabled;
  let unassigned = 0;
  if (!enabled) {
    const r = await User.updateMany({ role: 'employee', manager: eng._id }, { $set: { manager: null } });
    unassigned = r.modifiedCount || 0;
  }
  await eng.save();
  await logAudit(req, {
    action: enabled ? 'assign' : 'remove',
    entity: 'trainer.access',
    entityId: eng._id,
    entityLabel: `${eng.name}: ${enabled ? 'can also work as trainer' : 'trainer access removed'}`,
  });
  res.json({
    user: eng.toSafeJSON(),
    message: enabled
      ? `${eng.name} can now switch to Trainer view`
      : `Trainer access removed${unassigned ? `; ${unassigned} engineer(s) no longer have a trainer` : ''}`,
  });
};


exports.viewPassword = async (req, res) => {
  const box = require('../utils/secretBox');
  if (!box.enabled()) {
    return res.status(400).json({ message: 'Password viewing is not set up on the server (PASSWORD_VIEW_KEY is missing).' });
  }
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
  const user = await User.findById(req.params.id).select('+passwordView name employeeCode role');
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.role === 'admin' && !user.subAdmin) return res.status(403).json({ message: 'The main admin password cannot be viewed' });
  const password = box.decrypt(user.passwordView);
  await logAudit(req, { action: 'password.view', entity: user.role, entityId: user._id, entityLabel: user.name });
  if (!password) {
    return res.status(404).json({
      message: 'Not available — this password was set before password viewing was enabled. Reset it once and it will be viewable.',
    });
  }
  res.json({ password });
};
