const router = require('express').Router();
const ctrl = require('../controllers/insightsController');
const { requireAuth, requireRole, denySubAdmin } = require('../middleware/auth');
router.use(requireAuth);

router.post('/track', ctrl.track);

router.use(requireRole('admin', 'cto'), denySubAdmin);
router.get('/overview', ctrl.overview);
router.get('/activity', ctrl.activity);
router.get('/performance', ctrl.performance);
router.get('/database', ctrl.database);
router.get('/alerts', ctrl.alerts);
router.post('/alerts/run', requireRole('admin'), ctrl.runAlertsNow);
router.get('/logs/:kind', ctrl.logs);
router.get('/logs/:kind/:id', ctrl.logDetail);

module.exports = router;
