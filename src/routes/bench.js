const router = require('express').Router();
const ctrl = require('../controllers/benchController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

router.get('/', ctrl.list);
router.get('/report', ctrl.report);
router.post('/import', ctrl.importRows);
router.get('/:id', ctrl.getOne);
router.patch('/:id', ctrl.update);
router.post('/:id/comments', ctrl.addComment);
router.delete('/:id/comments/:commentId', ctrl.deleteComment);

module.exports = router;
