const router = require('express').Router();
const ctrl = require('../controllers/userController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.post('/ctos', requireRole('admin'), ctrl.createCTO);
router.get('/ctos', requireRole('admin'), ctrl.listCTOs);

router.post('/bus', requireRole('admin'), ctrl.createBU);
router.get('/bus', requireRole('admin', 'cto'), ctrl.listBUs);

router.post('/managers', requireRole('admin', 'bu'), ctrl.createManager);
router.post('/employees', requireRole('admin', 'bu', 'manager'), ctrl.createEmployee);

router.patch('/me/profile', requireRole('employee'), ctrl.updateMyProfile);
router.patch('/me/menu', requireRole('bu'), ctrl.updateMyMenu);
router.patch('/:id/status', requireRole('admin', 'bu', 'manager'), ctrl.setStatus);
router.get('/', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.listUsers);
router.get('/managers', requireRole('admin', 'cto', 'bu'), ctrl.listManagers);
router.patch('/:id/domains', requireRole('admin', 'bu', 'manager'), ctrl.assignDomains);
router.get('/:id', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.getUser);
router.patch('/:id/active', requireRole('admin', 'bu', 'manager'), ctrl.setActive);

module.exports = router;
