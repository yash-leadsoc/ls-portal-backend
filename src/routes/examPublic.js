const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/exam/examController');
const candidate = require('../controllers/exam/candidateController');

// Generous limit: exam centres often share one public IP.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.EXAM_REGISTER_RATE_LIMIT || 150),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many registration attempts. Please try again in a few minutes.' },
});

router.get('/exams', c.listPublic);
router.get('/exams/:id', c.getPublic);
router.post('/register', registerLimiter, candidate.register);

module.exports = router;
