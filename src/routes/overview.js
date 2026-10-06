const router = require('express').Router();
const ctrl = require('../controllers/overviewController');
const { requireAuth, requireRole, mgmtCan } = require('../middleware/auth');
router.use(requireAuth);
router.get('/', requireRole('admin', 'cto', 'bu', 'manager'), mgmtCan('overview'), ctrl.overview);
module.exports = router;
