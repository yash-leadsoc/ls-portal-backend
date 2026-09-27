const router = require('express').Router();
const ctrl = require('../controllers/qaController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/questions', ctrl.listQuestions);
router.post('/questions', ctrl.createQuestion);
router.get('/questions/:id', ctrl.getQuestion);
router.post('/questions/:id/answers', ctrl.createAnswer);

router.delete('/questions/:id', requireRole('admin'), ctrl.deleteQuestion);
router.delete('/answers/:id', requireRole('admin'), ctrl.deleteAnswer);

module.exports = router;
