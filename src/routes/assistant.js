const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const assistantController = require('../controllers/assistantController');

router.post('/chat', requireAuth, assistantController.chat);

module.exports = router;
