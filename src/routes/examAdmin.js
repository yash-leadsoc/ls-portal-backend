const router = require('express').Router();
const { requireExamAdmin } = require('../middleware/examAuth');
const { upload } = require('../middleware/upload');
const e = require('../controllers/exam/examController');
const s = require('../controllers/exam/examSetController');
const q = require('../controllers/exam/questionController');
const c = require('../controllers/exam/candidateController');
const a = require('../controllers/exam/analyticsController');
const x = require('../controllers/exam/exportController');

router.use(requireExamAdmin);

router.get('/dashboard', a.dashboard);

router.get('/exams', e.list);
router.post('/exams', e.create);
router.get('/exams/:id', e.get);
router.put('/exams/:id', e.update);
router.delete('/exams/:id', e.remove);
router.patch('/exams/:id/status', e.status);

router.get('/exams/:examId/sets', s.list);
router.post('/exams/:examId/sets', s.create);
router.get('/sets/:id', s.get);
router.put('/sets/:id', s.update);
router.delete('/sets/:id', s.remove);

router.get('/sets/:setId/questions', q.list);
router.post('/sets/:setId/questions', q.create);
router.put('/questions/:id', q.update);
router.delete('/questions/:id', q.remove);
router.post('/upload', upload.single('image'), q.uploadImage);

router.get('/candidates', c.list);
router.get('/candidates/export', x.candidates);

module.exports = router;
