const router = require('express').Router();
const { requireAttempt } = require('../middleware/examAuth');
const c = require('../controllers/exam/attemptController');

router.use('/:attemptId', requireAttempt);
router.get('/:attemptId/instructions', c.instructions);
router.post('/:attemptId/start', c.start);
router.get('/:attemptId/paper', c.paper);
router.put('/:attemptId/answers', c.save);
router.get('/:attemptId/status', c.status);
router.post('/:attemptId/violation', c.violation);
router.post('/:attemptId/submit', c.submit);
router.get('/:attemptId/result', c.result);

module.exports = router;
