const router = require('express').Router();
const ctrl = require('../controllers/resumeController');
const { requireAuth, requireRole, mgmtCan } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

router.use(requireAuth);

router.get('/me', requireRole('employee'), ctrl.getMine);
router.put('/me', requireRole('employee'), ctrl.saveMine);
router.post('/me/file', requireRole('employee'), upload.single('file'), ctrl.uploadFile);
router.delete('/me/file', requireRole('employee'), ctrl.deleteFile);
router.get('/user/:userId', requireRole('admin', 'cto', 'bu', 'manager'), mgmtCan('contact'), ctrl.getForUser);

module.exports = router;
