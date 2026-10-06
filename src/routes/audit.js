const router = require('express').Router();
const ctrl = require('../controllers/auditController');
const { requireAuth, requireRole, mgmtCan } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requireRole('admin', 'cto', 'bu', 'manager'), mgmtCan('activity'), ctrl.list);
router.post('/event', ctrl.record); 
router.get('/insights', requireRole('admin', 'cto', 'bu'), mgmtCan('activity'), ctrl.insights);

module.exports = router;
