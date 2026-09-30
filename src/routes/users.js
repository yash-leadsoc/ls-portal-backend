const router = require('express').Router();
const ctrl = require('../controllers/userController');
const { requireAuth, requireRole, requireFullAdmin } = require('../middleware/auth');
const { notifyAfter } = require('../services/notificationRules');

router.use(requireAuth);

router.post('/subadmins', requireFullAdmin, ctrl.createSubAdmin);
router.get('/subadmins', requireFullAdmin, ctrl.listSubAdmins);

router.post('/ctos', requireRole('admin'), ctrl.createCTO);
router.get('/ctos', requireRole('admin'), ctrl.listCTOs);

router.post('/bus', requireRole('admin'), ctrl.createBU);
router.get('/my-scope', ctrl.myScope);
router.get('/bus', requireRole('admin', 'cto'), ctrl.listBUs);
router.get('/bus/heads', requireRole('admin'), ctrl.listBUHeads);
router.post('/bus/:id/heads', requireRole('admin'), ctrl.addUnitHead);
router.delete('/bus/:id/heads/:headId', requireRole('admin'), ctrl.removeUnitHead);
router.patch('/bus/:id/login', requireRole('admin'), ctrl.setUnitLogin);

router.post('/managers', requireRole('admin', 'bu'), ctrl.createManager);
router.post('/employees', requireRole('admin', 'bu', 'manager'), ctrl.createEmployee);
router.post('/employees/bulk', requireRole('bu', 'admin'), ctrl.bulkCreateEmployees);

router.patch('/me/profile', requireRole('employee'), ctrl.updateMyProfile);
router.patch('/me/menu', requireRole('bu'), ctrl.updateMyMenu);
router.patch('/:id/status', requireRole('admin', 'bu', 'manager'), notifyAfter('status.changed'), ctrl.setStatus);
router.get('/', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.listUsers);
router.get('/managers', requireRole('admin', 'cto', 'bu'), ctrl.listManagers);
router.patch('/:id/trainer', requireRole('admin', 'bu'), ctrl.updateTrainer);
router.patch('/:id/engineer', requireRole('admin', 'bu', 'manager'), ctrl.updateEngineer);
router.patch('/:id/trainer-access', requireRole('admin', 'bu'), ctrl.setTrainerAccess);
router.patch('/:id/domains', requireRole('admin', 'bu', 'manager'), notifyAfter('domains.assigned'), ctrl.assignDomains);
router.get('/:id', requireRole('admin', 'cto', 'bu', 'manager'), ctrl.getUser);
router.patch('/:id/active', requireRole('admin', 'bu', 'manager'), ctrl.setActive);
router.delete('/:id', requireRole('admin', 'bu'), ctrl.deleteUser);

module.exports = router;
