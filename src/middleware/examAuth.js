const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const Attempt = require('../models/exam/ExamAttempt');
const ExamAdmin = require('../models/exam/ExamAdmin');
const TtlCache = require('../utils/ttlCache');

/* -------------------------------------------------------------------------- */
/*  Exam Admin (JWT signed with EXAM_ADMIN_JWT_SECRET, separate from the main  */
/*  portal's JWT_SECRET so a portal token can never open the exam admin API)   */
/* -------------------------------------------------------------------------- */

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

async function requireExamAdmin(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ message: 'Exam admin authentication required.' });
    if (!process.env.EXAM_ADMIN_JWT_SECRET) throw new Error('EXAM_ADMIN_JWT_SECRET is not configured.');

    // Pin the algorithm: never let the token header choose it.
    const decoded = jwt.verify(token, process.env.EXAM_ADMIN_JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.type !== 'exam_admin' || !decoded.sub) {
      return res.status(401).json({ message: 'Invalid Exam Admin token.' });
    }

    const admin = await ExamAdmin.findById(decoded.sub).select('adminId name email role active tokenVersion').lean();
    if (!admin || !admin.active) {
      return res.status(401).json({ message: 'Exam Admin account is inactive or unavailable.' });
    }
    // Tokens issued before a logout / forced sign-out carry an older version.
    if ((decoded.ver ?? 0) !== (admin.tokenVersion ?? 0)) {
      return res.status(401).json({ message: 'Session has ended. Please sign in again.' });
    }

    req.examAdmin = admin;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError') {
      return res.status(401).json({ message: 'Invalid or expired Exam Admin session.' });
    }
    next(error);
  }
}

/** Use after requireExamAdmin. Accounts created before roles existed count as 'admin'. */
const requireExamAdminRole = (...roles) => (req, res, next) => {
  const role = req.examAdmin?.role || 'admin';
  if (!roles.includes(role)) return res.status(403).json({ message: 'You do not have permission to perform this action.' });
  next();
};

/* -------------------------------------------------------------------------- */
/*  Candidate attempt authentication (opaque random token, only its SHA-256    */
/*  hash is stored). Candidates have no JWT and no admin surface.              */
/* -------------------------------------------------------------------------- */

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Heavy / unneeded arrays are never pulled into request context.
const LIGHT = '-responses -evaluations -suspiciousActivities';

/** Fresh read on every call. Used by everything except the hot save path. */
async function requireAttempt(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ message: 'Attempt token required.' });

    const attempt = await Attempt.findOne({ attemptId: req.params.attemptId, attemptTokenHash: hash(token) })
      .select(LIGHT)
      .lean();
    if (!attempt) return res.status(401).json({ message: 'Invalid attempt credentials.' });

    req.examAttempt = attempt;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Short-lived cache for the two hottest candidate endpoints (answer save and
 * proctoring events). Safe because those handlers re-assert status/expiry
 * inside their own atomic UPDATE filter, so a 5 s stale view can never let a
 * write through after submission. Entries are dropped immediately on submit
 * and on token rotation.
 */
const authCache = new TtlCache({ ttlMs: Number(process.env.ATTEMPT_AUTH_CACHE_MS || 5000), max: 3000 });
const CACHE_SELECT = 'attemptId exam candidate examSet status startedAt expiresAt createdAt';

async function requireAttemptCached(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ message: 'Attempt token required.' });

    const key = `${req.params.attemptId}:${hash(token)}`;
    let attempt = authCache.get(key);
    if (!attempt) {
      attempt = await Attempt.findOne({ attemptId: req.params.attemptId, attemptTokenHash: hash(token) }).select(CACHE_SELECT).lean();
      if (!attempt) return res.status(401).json({ message: 'Invalid attempt credentials.' });
      authCache.set(key, attempt);
    }
    req.examAttempt = attempt;
    next();
  } catch (error) {
    next(error);
  }
}

/** Call whenever an attempt's status or token changes. */
const invalidateAttemptAuth = (attemptId) => authCache.deleteWhere((k) => k.startsWith(`${attemptId}:`));

module.exports = { requireExamAdmin, requireExamAdminRole, requireAttempt, requireAttemptCached, invalidateAttemptAuth };
