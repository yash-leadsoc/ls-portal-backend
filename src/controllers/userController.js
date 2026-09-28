const User = require('../models/User');
const Domain = require('../models/Domain');
const { buOf, seesAll } = require('../utils/scope');
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
  } catch (err) { res.status(500).json({ message: 'Could not create CTO' }); }
};

exports.listCTOs = async (req, res) => {
  const ctos = await User.find({ role: 'cto' }).sort({ name: 1 });
  res.json({ ctos: ctos.map((c) => c.toSafeJSON()) });
};

exports.createBU = async (req, res) => {
  try {
    const { name, email, password, employeeCode, categoryId } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email and password are required' });
    }
    if (!employeeCode || !employeeCode.trim()) {
      return res.status(400).json({ message: 'BU ID is required' });
    }
    if (!categoryId) return res.status(400).json({ message: 'Category is required' });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'A user with this email already exists' });
    const codeExists = await User.findOne({ employeeCode: employeeCode.trim() });
    if (codeExists) return res.status(409).json({ message: 'A user with this ID already exists' });

    const user = new User({
      name,
      email: email.toLowerCase(),
      employeeCode: employeeCode.trim(),
      role: 'bu',
      category: categoryId,
      createdBy: req.user._id,
    });
    await user.setPassword(password);
    await user.save();
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ message: 'Could not create BU' });
  }
};

exports.listBUs = async (req, res) => {
  const bus = await User.find({ role: 'bu' }).populate('category', 'name').sort({ name: 1 });
  res.json({
    bus: bus.map((b) => ({ ...b.toSafeJSON(), categoryName: b.category?.name || null })),
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
    if (req.user.role === 'bu') businessUnit = req.user._id;
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
    // const { name, email, password, employeeCode, managerId } = req.body;
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
      businessUnit = req.user._id;
      manager = managerId || null;
    } else if (req.user.role === 'admin') {
      businessUnit = req.body.businessUnit || null;
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

    if (req.user.role === 'admin' || req.user.role === 'cto') {
      if (role) filter.role = role;
    } else if (req.user.role === 'bu') {
      filter = { businessUnit: req.user._id };
      if (role) filter.role = role;
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
      // const benchFrom = u.benchStart || u.enrolledAt || u.createdAt;
      // const benchDays = benchFrom ? Math.max(0, Math.floor((now - new Date(benchFrom).getTime()) / 86400000)) : 0;
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
  const filter = { role: 'manager' };
  if (req.user.role === 'bu') filter.businessUnit = req.user._id;
  const managers = await User.find(filter).sort({ name: 1 });
  res.json({ managers: managers.map((m) => m.toSafeJSON()) });
};

exports.getUser = async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate({ path: 'businessUnit', select: 'name category', populate: { path: 'category', select: 'name' } })
    .populate('manager', 'name');
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (req.user.role === 'bu' && String(user.businessUnit) !== String(req.user._id)) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  if (
    req.user.role === 'manager' &&
    String(user.businessUnit) !== String(req.user.businessUnit) &&
    String(user.manager) !== String(req.user._id)
  ) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  // const benchFrom = user.benchStart || user.enrolledAt || user.createdAt;
  // const benchDays = benchFrom ? Math.max(0, Math.floor((Date.now() - new Date(benchFrom).getTime()) / 86400000)) : 0;
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

// exports.setStatus = async (req, res) => {
//   try {
//     const u = await User.findById(req.params.id);
//     if (!u) return res.status(404).json({ message: 'User not found' });
//     const { jobStatus, benchStart } = req.body;
//     if (jobStatus) u.jobStatus = jobStatus;
//     if (benchStart !== undefined) u.benchStart = benchStart ? new Date(benchStart) : null;
//     await u.save();
//     res.json({ user: u.toSafeJSON() });
//   } catch (e) {
//     res.status(500).json({ message: 'Could not update status' });
//   }
// };

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

exports.setActive = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ message: 'Cannot deactivate admin' });
  user.active = !!req.body.active;
  await user.save();
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

  const businessUnit = req.user._id;

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
    User.find({ role: 'manager', businessUnit, active: true }).select('employeeCode name').lean(),
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
