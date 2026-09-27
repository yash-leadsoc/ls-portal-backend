const router = require('express').Router();
const ctrl = require('../controllers/documentController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

router.use(requireAuth);

router.post('/', requireRole('admin', 'bu', 'manager'), upload.single('file'), ctrl.upload);
router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.get('/:id/preview', ctrl.preview);
router.get('/:id/download', ctrl.download);
router.post('/:id/review', requireRole('employee'), ctrl.markReviewed);

router.delete(
  '/remove-all',
  requireRole('admin'),
  ctrl.removeAll
);

router.delete('/:id', requireRole('admin', 'bu', 'manager'), ctrl.remove);
router.post('/link', requireRole('admin', 'bu', 'manager'), ctrl.createLink);

module.exports = router;
