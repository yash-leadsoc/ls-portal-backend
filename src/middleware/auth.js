const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { canActAs } = require('../utils/units');
const { computeScope } = require('../utils/scope');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

const SECRET = () => process.env.JWT_SECRET || 'dev_secret_change_me';

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, name: user.name },
    SECRET(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d', algorithm: 'HS256' }
  );
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });

    const payload = jwt.verify(token, SECRET(), { algorithms: ['HS256'] });
    const user = await User.findById(payload.id).populate(
      'assignedDomains',
      'name icon description'
    );

    if (!user || !user.active) return res.status(401).json({ message: 'Invalid or inactive account' });
    if (user.loginDisabled) return res.status(401).json({ message: 'Login is disabled for this account' });

    req.user = user;

    const personalPath = /^\/api\/(auth|notifications|insights\/track|users\/me)(\/|$)/.test((req.originalUrl || '').split('?')[0]);
    if (user.role === 'bu' && !personalPath) {
      const wanted = req.headers['x-unit'];
      let unitId = null;
      if (wanted && canActAs(user, wanted)) unitId = String(wanted);
      else if (user.headOnly && (user.unitAccess || []).length) unitId = String(user.unitAccess[0].unit);
      if (unitId && unitId !== String(user._id)) {
        const unit = await User.findOne({ _id: unitId, role: 'bu', active: true }).populate('assignedDomains', 'name icon description');
        if (unit) {
          req.actor = user;
          req.user = unit;
        }
      }
    }
    if (
      req.user.role === 'employee' &&
      req.user.trainerAccess &&
      req.headers['x-view'] === 'trainer' &&
      !personalPath
    ) {
      const asTrainer = User.hydrate({ ...req.user.toObject({ depopulate: true }), role: 'manager' });
      asTrainer.$locals.viewingAs = 'trainer';
      req.actor = req.actor || req.user;
      req.user = asTrainer;
    }
    try {
      await computeScope(req.user);
    } catch (e) {}
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient role' });
    }
    next();
  };
}

function requireFullAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || req.user.subAdmin) {
    return res.status(403).json({ message: 'Only the main admin can do this' });
  }
  next();
}

function denySubAdmin(req, res, next) {
  if (req.user && req.user.subAdmin) {
    return res.status(403).json({ message: 'Sub admins do not have access to this section' });
  }
  next();
}

module.exports = { signToken, requireAuth, requireRole, requireFullAdmin, denySubAdmin };
