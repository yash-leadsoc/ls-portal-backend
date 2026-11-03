const Attempt = require('../../models/exam/ExamAttempt');
const Question = require('../../models/exam/ExamQuestion');
const Result = require('../../models/exam/ExamResult');
const rank = require('../../services/exam/examRanking');
const { recompute } = require('../../services/exam/examScoring');
const { evaluateAttempt, aiEnabled, MODEL } = require('../../services/exam/examAiEvaluator');
const { FINAL, DESCRIPTIVE } = require('../../services/exam/examConstants');

// PATCH /results/:attemptId/answers/:questionId  { marks, comment }  – manual grade / override of an AI grade
exports.evaluate = async (req, res) => {
  const a = await Attempt.findById(req.params.attemptId);
  if (!a) return res.status(404).json({ message: 'Attempt not found' });
  if (!FINAL.includes(a.status)) return res.status(409).json({ message: 'This attempt has not been submitted yet' });

  const q = await Question.findOne({ _id: req.params.questionId, set: a.examSet });
  if (!q || !DESCRIPTIVE.includes(q.type)) return res.status(400).json({ message: 'Not a written-answer question of this paper' });

  const marks = Number(req.body?.marks);
  if (req.body?.marks === '' || req.body?.marks == null || !Number.isFinite(marks) || marks < 0 || marks > q.marks) {
    return res.status(400).json({ message: `Marks must be between 0 and ${q.marks}` });
  }
  const entry = { question: q._id, marks, comment: String(req.body?.comment || '').slice(0, 2000), source: 'Manual', evaluatedBy: req.user._id, evaluatedAt: new Date() };
  const i = a.evaluations.findIndex((e) => String(e.question) === String(q._id));
  if (i >= 0) a.evaluations[i] = entry;
  else a.evaluations.push(entry);
  await a.save();

  const r = await recompute(a._id);
  res.json({ result: r.result, attempt: { obtainedMarks: r.total, evaluationPending: r.pending } });
};

// POST /results/exam/:examId/recalculate
exports.recalculate = async (req, res) => {
  const n = await rank(req.params.examId);
  res.json({ message: `Rankings recalculated for ${n} result${n === 1 ? '' : 's'}` });
};

exports.aiStatus = (req, res) => res.json({ enabled: aiEnabled(), model: aiEnabled() ? MODEL() : null });

// POST /results/:attemptId/ai-evaluate  { force? } – (re)grade one attempt now
exports.aiEvaluateOne = async (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ message: 'AI evaluation is not configured. Set ANTHROPIC_API_KEY on the server.' });
  const out = await evaluateAttempt(req.params.attemptId, { force: !!req.body?.force });
  if (out.skipped === 'busy or not submitted') return res.status(409).json({ message: 'This attempt is already being evaluated or has not been submitted.' });
  res.json(out);
};

// POST /results/ai-evaluate-pending  { exam? } – queue every attempt still waiting for evaluation
exports.aiEvaluatePending = async (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ message: 'AI evaluation is not configured. Set ANTHROPIC_API_KEY on the server.' });
  const filter = { status: { $in: FINAL }, evaluationPending: true };
  if (req.body?.exam) filter.exam = req.body.exam;
  const ids = (await Attempt.find(filter).select('_id').limit(500)).map((x) => x._id);
  (async () => {
    for (const id of ids) await evaluateAttempt(id).catch((e) => console.error('AI evaluation failed:', e.message));
  })();
  res.json({ queued: ids.length, message: ids.length ? `AI evaluation started for ${ids.length} attempt${ids.length === 1 ? '' : 's'}` : 'Nothing is waiting for evaluation' });
};
