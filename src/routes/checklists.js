const router = require('express').Router();
const ctrl = require('../controllers/checklistController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notifyAfter } = require('../services/notificationRules');

router.use(requireAuth);

router.post('/', requireRole('admin', 'bu', 'manager'), notifyAfter('checklist.created'), ctrl.create);
router.get('/by-document/:documentId', ctrl.listByDocument);
router.get('/:id', ctrl.getOne);
router.patch('/:id', requireRole('admin','bu', 'manager'), ctrl.update);
router.delete('/:id', requireRole('admin', 'bu'), ctrl.remove);
router.get('/domain/:domainId', ctrl.checklistForDomain);
router.put('/:id', requireRole('admin', 'bu'), ctrl.updateChecklist);

router.get('/:id/my-response', requireRole('employee'), ctrl.myResponse);
router.put('/:id/my-response', requireRole('employee'), ctrl.saveResponse);

module.exports = router;
