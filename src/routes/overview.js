const router = require('express').Router();
const ctrl = require('../controllers/overviewController');
const { requireAuth, requireRole } = require('../middleware/auth');
router.use(requireAuth);
router.get('/', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.overview);
module.exports = router;
