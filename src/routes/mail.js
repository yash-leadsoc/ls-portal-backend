const router = require('express').Router();
const ctrl = require('../controllers/mailController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin'));

router.get('/config', ctrl.config);
router.put('/server', ctrl.saveServer);
router.put('/account', ctrl.saveAccount);
router.delete('/account', ctrl.removeAccount);
router.get('/recipients', ctrl.recipients);
router.post('/preview', ctrl.preview);
router.post('/send', ctrl.send);
router.get('/campaigns', ctrl.campaigns);
router.get('/campaigns/:id', ctrl.campaign);

module.exports = router;
