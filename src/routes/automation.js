const router = require('express').Router();
const ctrl = require('../controllers/automationController');
const { requireAuth, requireFullAdmin } = require('../middleware/auth');

router.use(requireAuth, requireFullAdmin);

router.get('/', ctrl.status);
router.put('/', ctrl.save);
router.post('/weekly/preview', ctrl.preview);
router.post('/weekly/test', ctrl.test);
router.post('/weekly/run', ctrl.runWeekly);
router.post('/inactivity/run', ctrl.runInactivity);
router.get('/logs', ctrl.logs);

module.exports = router;
