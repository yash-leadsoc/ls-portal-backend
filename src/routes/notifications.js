const router = require('express').Router();

const controller = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/public-key', controller.getPublicKey);

router.post('/subscribe', controller.subscribe);

router.post('/unsubscribe', controller.unsubscribe);

router.get('/', controller.list);

router.patch('/:id/read', controller.markRead);

router.patch('/read-all', controller.markAllRead);

module.exports = router;
