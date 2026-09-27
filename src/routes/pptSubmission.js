const express = require('express');
const router = express.Router();

const controller = require('../controllers/pptSubmissionController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post(
  '/',
  requireAuth,
  requireRole('employee'),
  controller.submit
);

router.get('/employee/:id',requireAuth, requireRole('admin', 'cto', 'bu', 'manager'), controller.getEmployeeSubmissions);

module.exports = router;
