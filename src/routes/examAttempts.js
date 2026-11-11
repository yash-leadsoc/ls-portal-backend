const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireAttempt, requireAttemptCached } = require('../middleware/examAuth');
const { skipMutationLog } = require('../middleware/examProctoringAuth');
const proctoring = require('./examProctoring');
const c = require('../controllers/exam/attemptController');

// Autosave budget is per attempt (never per IP: exam centres share one public IP).
// A healthy client sends <= ~1 request/second/question after debouncing.
const saveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.EXAM_SAVE_RATE_LIMIT || 240),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `sv:${req.params.attemptId}`,
  message: { message: 'Saving too quickly. Please wait a moment.' },
});

// Hot paths use the short-lived auth cache and are matched BEFORE the generic guard below.
router.put('/:attemptId/answers', requireAttemptCached, saveLimiter, skipMutationLog, c.save);
router.use('/:attemptId/proctoring', requireAttemptCached, proctoring.candidate);

router.use('/:attemptId', requireAttempt);
router.get('/:attemptId/instructions', c.instructions);
router.post('/:attemptId/start', c.start);
router.get('/:attemptId/paper', c.paper);
router.get('/:attemptId/status', c.status);
router.post('/:attemptId/violation', c.violation);
router.post('/:attemptId/submit', c.submit);
router.get('/:attemptId/result', c.result);

module.exports = router;
