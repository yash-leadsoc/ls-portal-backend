const router = require('express').Router();
const ctrl = require('../controllers/writeupController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notifyAfter } = require('../services/notificationRules');

router.use(requireAuth);

router.post('/', requireRole('admin', 'bu','manager'), notifyAfter('writeup.created'), ctrl.create);
router.get('/by-document/:documentId', ctrl.listByDocument);
router.get('/:id', ctrl.getOne);
router.patch('/:id', requireRole('admin','bu', 'manager'), ctrl.update);
router.delete('/:id', requireRole('admin', 'bu','bu'), ctrl.remove);
router.get('/domain/:domainId', ctrl.writeupForDomain);
router.delete('/:id', requireRole('admin'), ctrl.deleteWriteup);
router.put('/:id', requireRole('admin', 'bu'), ctrl.updateWriteup);

router.get('/:id/my-answer', requireRole('employee'), ctrl.myAnswer);
router.put('/:id/my-answer', requireRole('employee'), ctrl.saveAnswer);

module.exports = router;
