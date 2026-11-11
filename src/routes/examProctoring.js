const express = require('express');
const c = require('../controllers/exam/proctoringController');
const { requireExamAdminRole } = require('../middleware/examAuth');
const { requireProctoringEnabled, proctoringLimiter, skipMutationLog } = require('../middleware/examProctoringAuth');

/**
 * Candidate router - mounted by routes/examAttempts.js at
 *   /api/exam/attempts/:attemptId/proctoring
 * AFTER requireAttemptCached, so req.examAttempt is already authenticated.
 */
const candidate = express.Router({ mergeParams: true });
candidate.use(requireProctoringEnabled, proctoringLimiter, skipMutationLog);
candidate.put('/session', c.updateSession);
candidate.post('/events', c.ingest);

/**
 * Admin router - mounted by routes/examAdmin.js at /api/exam/admin/proctoring
 * AFTER requireExamAdmin. Viewing + reviewing events: any exam admin account.
 * Resolving/escalating cases and accommodation decisions: role 'admin' only.
 */
const admin = express.Router();
const adminOnly = requireExamAdminRole('admin');
admin.get('/overview', c.overview);
admin.get('/candidates', c.candidates);
admin.get('/candidates/:attemptId', c.candidateDetail);
admin.patch('/events/:eventId/review', c.reviewEvent);
admin.patch('/candidates/:attemptId/case', c.setCase);
admin.get('/accommodations', c.accommodations);
admin.patch('/candidates/:attemptId/accommodation', adminOnly, c.decideAccommodation);

module.exports = { candidate, admin };
