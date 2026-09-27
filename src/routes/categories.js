const router = require('express').Router();
const ctrl = require('../controllers/categoryController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.get('/', ctrl.listCategories);
router.post('/', requireRole('admin'), ctrl.createCategory);
router.delete('/:id', requireRole('admin'), ctrl.deleteCategory);
module.exports = router;
