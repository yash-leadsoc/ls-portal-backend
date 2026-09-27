const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
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

    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.active) return res.status(403).json({ message: 'Account is inactive' });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const token = signToken(user);

    await logAudit(req, {
      action: 'login',
      entity: 'auth',
      entityId: user._id,
      entityLabel: user.name,
      meta: { email: user.email, at: new Date().toISOString() },
    });

    res.json({ token, user: user.toSafeJSON() });
  } catch (err) {
    res.status(500).json({ message: 'Login failed' });
  }
};

exports.me = async (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
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
    
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ message: 'Could not update password' });
  }
};
