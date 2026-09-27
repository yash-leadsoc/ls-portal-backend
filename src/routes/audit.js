const router = require('express').Router();
const ctrl = require('../controllers/auditController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.list);
router.post('/event', ctrl.record); 
router.get('/insights', requireRole('admin', 'cto', 'bu'), ctrl.insights);

module.exports = router;
