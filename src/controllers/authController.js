const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { unitsFor } = require('../utils/units');
const escapeRegex = require('../utils/escapeRegex');
exports.login = async (req, res) => {
  try {
    const { identifier, email, password } = req.body;
    const rawId = identifier || email || '';
    if (typeof rawId !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Enter an email/ID and password to continue.' });
    }
    const id = rawId.trim().toLowerCase();
    if (!id || !password) {
      return res.status(400).json({ message: 'Enter an email/ID and password to continue.' });
    }

    const user = await User.findOne({
      $or: [{ email: id }, { employeeCode: new RegExp(`^${escapeRegex(id)}$`, 'i') }],
    });

    const failed = (reason, who) =>
      logAudit(req, {
        action: 'login.failed',
        entity: 'auth',
        entityId: who ? who._id : null,
        entityLabel: id,
        meta: { reason },
        actor: who ? { _id: who._id, name: who.name, role: who.role, businessUnit: who.businessUnit } : { name: id },
      });

    if (!user) {
      await failed('unknown account');
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (!user.active) {
      await failed('inactive account', user);
      return res.status(403).json({ message: 'Account is inactive' });
    }
    if (user.loginDisabled) {
      await failed('login disabled', user);
      return res.status(403).json({ message: 'Login is disabled for this account' });
    }

    const ok = await user.verifyPassword(password);
    if (!ok) {
      await failed('wrong password', user);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), lastActiveAt: new Date() } });

    const token = signToken(user);

    await logAudit(req, {
      action: 'login',
      entity: 'auth',
      entityId: user._id,
      entityLabel: user.name,
      meta: { email: user.email, at: new Date().toISOString() },
      actor: user,
    });

    const { effectivePerms } = require('../utils/mgmtPerms');
    res.json({ token, user: { ...user.toSafeJSON(), units: await unitsFor(user), permissions: await effectivePerms(user) } });
  } catch (err) {
    res.status(500).json({ message: 'Login failed' });
  }
};

exports.logout = async (req, res) => {
  const PushSubscription = require('../models/PushSubscription');
  const endpoint = typeof req.body.endpoint === 'string' ? req.body.endpoint : null;
  if (endpoint) await PushSubscription.deleteOne({ user: req.user._id, endpoint });
  await logAudit(req, { action: 'logout', entity: 'auth', entityId: req.user._id, entityLabel: req.user.name });
  res.json({ message: 'Logged out' });
};

exports.me = async (req, res) => {
  const person = req.actor || req.user;
  const { effectivePerms } = require('../utils/mgmtPerms');
  res.json({ user: { ...person.toSafeJSON(), units: await unitsFor(person), permissions: await effectivePerms(person) } });
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    const ok = await req.user.verifyPassword(currentPassword || '');
    if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });
    await req.user.setPassword(newPassword);
    await req.user.save();
    await logAudit(req, { action: 'password.change', entity: 'auth', entityId: req.user._id, entityLabel: req.user.name });
    
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ message: 'Could not update password' });
  }
};
