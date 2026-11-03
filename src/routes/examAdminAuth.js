const express = require('express');
const router = express.Router();

const { login } = require('../controllers/exam/examAdminAuthController');

router.post('/login', login);

module.exports = router;