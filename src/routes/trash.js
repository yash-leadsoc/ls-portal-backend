const router = require('express').Router();
const ctrl = require('../controllers/trashController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

router.get('/', ctrl.list);
router.post('/:id/restore', ctrl.restore);
router.delete('/:id', ctrl.purge);

module.exports = router;