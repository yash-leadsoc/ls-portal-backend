const rateLimit = require('express-rate-limit');
const { getExam } = require('../services/exam/examCache');
const { effectiveConfig } = require('../services/exam/proctoringPolicy');

/**
 * Candidate-side proctoring guards. They run AFTER requireAttemptCached, which has
 * already proven the caller holds this attempt's token - so the attempt/candidate/
 * exam ids used by the controller come from the server, never from the request body.
 */

// Loads the exam's (clamped) AI-proctoring config; 404 when the feature is off for this exam.
async function requireProctoringEnabled(req, res, next) {
  try {
    const exam = await getExam(req.examAttempt.exam);
    const cfg = effectiveConfig(exam?.aiProctoring);
    if (!exam || !cfg.enabled) return res.status(404).json({ message: 'AI proctoring is not enabled for this examination.' });
    req.proctoringConfig = cfg;
    next();
  } catch (e) {
    next(e);
  }
}

// Per-attempt (not per-IP: an exam centre shares one public IP) request budget.
const proctoringLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.PROCTORING_EVENT_RATE_LIMIT || 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `pa:${req.params.attemptId}`,
  message: { message: 'Too many proctoring requests. Slow down.' },
});

// Successful mutations on hot exam paths are already visible in the in-memory
// metrics; skip the per-request RequestLog insert (errors are still logged).
const skipMutationLog = (req, res, next) => {
  res.locals.skipRequestLog = true;
  next();
};

module.exports = { requireProctoringEnabled, proctoringLimiter, skipMutationLog };
