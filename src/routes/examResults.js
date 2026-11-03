const router = require('express').Router();
const { requireExamAdmin } = require('../middleware/examAuth');
const r = require('../controllers/exam/resultController');
const e = require('../controllers/exam/evaluationController');
const x = require('../controllers/exam/exportController');

router.use(requireExamAdmin);
router.get('/', r.list);
router.get('/export', x.results);
router.get('/ai-status', e.aiStatus);
router.post('/ai-evaluate-pending', e.aiEvaluatePending);
router.post('/exam/:examId/recalculate', e.recalculate);
router.get('/:attemptId', r.report);
router.patch('/:attemptId/answers/:questionId', e.evaluate);
router.post('/:attemptId/ai-evaluate', e.aiEvaluateOne);

module.exports = router;
