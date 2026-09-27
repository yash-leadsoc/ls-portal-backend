const User = require('../models/User');
const Domain = require('../models/Domain');
const { buOf, seesAll } = require('../utils/scope');
const { logAudit } = require('../utils/audit');

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
    const { name, email, password, employeeCode, managerId } = req.body;
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
      const benchFrom = u.benchStart || u.enrolledAt || u.createdAt;
      const benchDays = benchFrom ? Math.max(0, Math.floor((now - new Date(benchFrom).getTime()) / 86400000)) : 0;
      return {
        ...base,
        buName: u.businessUnit?.name || null,
        categoryName: u.businessUnit?.category?.name || null,
        trainerName: u.manager?.name || null,
        benchDays,
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
  const benchFrom = user.benchStart || user.enrolledAt || user.createdAt;
  const benchDays = benchFrom ? Math.max(0, Math.floor((Date.now() - new Date(benchFrom).getTime()) / 86400000)) : 0;
  res.json({
    user: {
      ...user.toSafeJSON(),
      buName: user.businessUnit?.name || null,
      categoryName: user.businessUnit?.category?.name || null,
      trainerName: user.manager?.name || null,
      benchDays,
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
    if (preferredLocation != null) u.preferredLocation = String(preferredLocation);
    if (contactNumber != null) u.contactNumber = String(contactNumber);
    if (skills != null) {
      u.skills = Array.isArray(skills)
        ? skills
        : String(skills).split(',').map((x) => x.trim()).filter(Boolean);
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
    if (!u) return res.status(404).json({ message: 'User not found' });
    const { jobStatus, benchStart } = req.body;
    if (jobStatus) u.jobStatus = jobStatus;
    if (benchStart !== undefined) u.benchStart = benchStart ? new Date(benchStart) : null;
    await u.save();
    res.json({ user: u.toSafeJSON() });
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
