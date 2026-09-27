const router = require('express').Router();
const ctrl = require('../controllers/trackingController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/me', requireRole('employee'), ctrl.myProgress);
router.get('/export/engineers', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.exportEngineers);
router.get('/cohort', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.cohort);
router.get('/employee/:id', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.employeeProgress);

module.exports = router;
