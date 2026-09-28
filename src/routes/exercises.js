const router = require('express').Router();
const ctrl = require('../controllers/exerciseController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notifyAfter } = require('../services/notificationRules');
const { upload } = require('../middleware/upload');

router.use(requireAuth);

router.get('/', ctrl.listForDomain);
router.post('/', requireRole('admin', 'bu', 'manager'), notifyAfter('exercise.created'), upload.single('file'), ctrl.create);
router.patch('/:id', requireRole('admin', 'bu', 'manager'), ctrl.update);
router.delete('/:id', requireRole('admin', 'bu', 'manager'), ctrl.remove);
router.put('/:id/my-submission', requireRole('employee'), ctrl.submit);
router.get('/:id/submissions', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.submissionsFor);

module.exports = router;
