const router = require('express').Router();
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/login', ctrl.login);
router.get('/me', requireAuth, ctrl.me);
router.post('/logout', requireAuth, ctrl.logout);
router.post('/change-password', requireAuth, ctrl.changePassword);

module.exports = router;
