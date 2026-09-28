const router = require('express').Router();
const ctrl = require('../controllers/settingsController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/help-video', ctrl.getHelpVideo);
router.put('/help-video', requireRole('admin'), ctrl.setHelpVideo);

module.exports = router;
