const router = require('express').Router();
const ctrl = require('../controllers/interviewController');
const company = require('../controllers/companyController');
const { requireAuth, requireRole, mgmtCan } = require('../middleware/auth');
const { notifyAfter } = require('../services/notificationRules');
const { upload } = require('../middleware/upload');

router.use(requireAuth);

router.get('/companies', company.listCompanies);
router.post('/companies', requireRole('admin'), company.createCompany);
router.delete('/companies/:id', requireRole('admin'), company.deleteCompany);

router.get('/materials', ctrl.listMaterials);
router.post('/materials', requireRole('admin', 'bu', 'manager', 'employee'), upload.single('file'), ctrl.uploadMaterial);
router.delete('/materials/:id', requireRole('admin', 'bu', 'manager'), ctrl.deleteMaterial);

router.get('/mocks', ctrl.listMocks);
router.post('/mocks', requireRole('admin', 'bu', 'manager', 'cto'), mgmtCan('interviews_manage'), ctrl.scheduleMock);
router.patch('/mocks/:id/score', requireRole('admin', 'bu', 'manager', 'cto'), mgmtCan('interviews_manage'), notifyAfter('mock.scored'), ctrl.scoreMock);

router.get('/clients', ctrl.listClients);
router.post('/clients', requireRole('admin', 'bu'), notifyAfter('client.created'), ctrl.createClient);
router.patch('/clients/:id', requireRole('admin', 'bu'), notifyAfter('client.updated'), ctrl.updateClient);

router.get('/availability', ctrl.listAvailability);
router.post('/availability', requireRole('employee'), ctrl.addAvailability);
router.delete('/availability/:id', ctrl.deleteAvailability);

router.get('/history/:employeeId', requireRole('admin', 'cto', 'bu', 'manager'), mgmtCan('interviews'), ctrl.employeeHistory);

module.exports = router;
