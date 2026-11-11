const express = require('express');
const router = express.Router();

const { login, logout } = require('../controllers/exam/examAdminAuthController');
const { requireExamAdmin } = require('../middleware/examAuth');

router.post('/login', login);
router.post('/logout', requireExamAdmin, logout);

module.exports = router;
