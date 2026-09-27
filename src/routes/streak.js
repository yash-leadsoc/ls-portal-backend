const router = require('express').Router();
const ctrl = require('../controllers/streakController');
const { requireAuth, requireRole } = require('../middleware/auth');
router.use(requireAuth);
router.get('/me', requireRole('employee'), ctrl.myStreak);
module.exports = router;
