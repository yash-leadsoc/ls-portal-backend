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


const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
const GENERIC_SENT = 'If an account with a valid email exists, a 6-digit code has been sent to it. It expires in 10 minutes.';

function otpHash(userId, otp) {
  const cryptoMod = require('crypto');
  return cryptoMod.createHmac('sha256', process.env.JWT_SECRET || 'tedp').update(`${userId}:${otp}`).digest('hex');
}

async function findByIdentifier(identifier) {
  const User = require('../models/User');
  const id = String(identifier || '').trim();
  if (!id || id.length > 160) return null;
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({
    $or: [{ email: id.toLowerCase() }, { employeeCode: new RegExp(`^${esc}$`, 'i') }],
  });
}

exports.forgotPassword = async (req, res) => {
  const PasswordReset = require('../models/PasswordReset');
  const { systemSender, openSender, canReceive } = require('../services/mailer');
  try {
    const user = await findByIdentifier(req.body && req.body.identifier);
    if (!user || !user.active || user.loginDisabled || !canReceive(user.email)) {
      return res.json({ message: GENERIC_SENT });
    }
    const existing = await PasswordReset.findOne({ user: user._id });
    if (existing && Date.now() - new Date(existing.lastSentAt).getTime() < OTP_RESEND_SECONDS * 1000) {
      return res.json({ message: GENERIC_SENT });
    }
    const sender = await systemSender();
    if (sender.error) {
      return res.status(503).json({ message: 'Password reset by email is not available right now. Please contact your admin.' });
    }
    const otp = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
    await PasswordReset.findOneAndUpdate(
      { user: user._id },
      { $set: { otpHash: otpHash(user._id, otp), expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60000), attempts: 0, lastSentAt: new Date() } },
      { upsert: true }
    );
    const mailer = openSender(sender);
    try {
      await mailer.send({
        fromName: 'LeadSoC TEDP',
        to: user.email,
        toName: user.name,
        subject: `Your TEDP password reset code: ${otp}`,
        text: `Dear ${user.name},\n\nYour password reset code is ${otp}.\nIt expires in ${OTP_TTL_MIN} minutes.\n\nIf you did not ask to reset your password, ignore this email.\n\n— LeadSoC TEDP`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">Dear ${String(user.name).replace(/[<>&]/g, '')},<br><br>Your password reset code is<div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#102a56;margin:12px 0">${otp}</div>It expires in ${OTP_TTL_MIN} minutes.<br><br><span style="color:#64748b;font-size:12px">If you did not ask to reset your password, ignore this email.</span><br><br>— LeadSoC TEDP</div>`,
      });
    } finally {
      mailer.close();
    }
    await logAudit(req, { action: 'password.otp', entity: 'auth', entityId: user._id, entityLabel: user.name, actor: user });
    res.json({ message: GENERIC_SENT });
  } catch (err) {
    res.status(500).json({ message: 'Could not send the code. Please try again later.' });
  }
};

exports.resetPassword = async (req, res) => {
  const PasswordReset = require('../models/PasswordReset');
  const { identifier, otp, newPassword } = req.body || {};
  const invalid = () => res.status(400).json({ message: 'The code is invalid or has expired. Request a new one.' });
  try {
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    if (!/^\d{6}$/.test(String(otp || ''))) return invalid();
    const user = await findByIdentifier(identifier);
    if (!user || !user.active) return invalid();
    const rec = await PasswordReset.findOne({ user: user._id });
    if (!rec || new Date(rec.expiresAt) < new Date() || rec.attempts >= OTP_MAX_ATTEMPTS) return invalid();
    if (rec.otpHash !== otpHash(user._id, String(otp))) {
      rec.attempts += 1;
      await rec.save();
      const left = OTP_MAX_ATTEMPTS - rec.attempts;
      return res.status(400).json({ message: left > 0 ? `Wrong code. ${left} attempt(s) left.` : 'Too many wrong attempts. Request a new code.' });
    }
    await user.setPassword(String(newPassword));
    await user.save();
    await PasswordReset.deleteOne({ _id: rec._id });
    await logAudit(req, { action: 'password.reset', entity: 'auth', entityId: user._id, entityLabel: user.name, actor: user });
    res.json({ message: 'Password changed. You can sign in now.' });
  } catch (err) {
    res.status(500).json({ message: 'Could not reset the password. Please try again.' });
  }
};
