const router = require('express').Router();
const ctrl = require('../controllers/domainController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', requireRole('admin', 'bu', 'manager'), ctrl.create);
router.patch('/:id', requireRole('admin', 'bu', 'manager'), ctrl.update);
router.delete('/:id', requireRole('admin', 'bu'), ctrl.deleteDomain);

module.exports = router;
