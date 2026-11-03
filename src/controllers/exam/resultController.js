const Result = require('../../models/exam/ExamResult');
const Attempt = require('../../models/exam/ExamAttempt');
const Question = require('../../models/exam/ExamQuestion');
const { withRanks } = require('../../services/exam/examRanking');
const { evaluateObjective, hasAnswer } = require('../../services/exam/examEvaluator');

async function resultRows(query) {
  const filter = {};
  if (query.exam) filter.exam = query.exam;
  let rows = await Result.find(filter)
    .populate('candidate', 'candidateId name email phone')
    .populate('exam', 'name maximumMarks passingMarks')
    .populate('attempt', 'attemptId status violationCount autoSubmitted autoSubmitReason submittedAt startedAt aiEvaluation evaluationPending evaluations.source')
    .sort({ createdAt: -1 })
    .limit(3000)
    .lean();
  withRanks(rows); // rank is computed over the whole exam, before any filtering below
  // Date filter on the submission time. `from`/`to` are ISO instants (the browser sends its own local day boundaries).
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if ((from && !isNaN(from)) || (to && !isNaN(to))) {
    rows = rows.filter((r) => {
      const t = new Date(r.attempt?.submittedAt || r.createdAt);
      return (!from || isNaN(from) || t >= from) && (!to || isNaN(to) || t <= to);
    });
  }
  if (query.status) rows = rows.filter((r) => r.status === query.status);
  if (query.flagged === 'true') rows = rows.filter((r) => (r.attempt?.violationCount || 0) > 0);
  if (query.q) {
    const q = String(query.q).toLowerCase();
    rows = rows.filter((r) => [r.candidate?.name, r.candidate?.email, r.candidate?.candidateId].some((v) => String(v || '').toLowerCase().includes(q)));
  }
  rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || new Date(b.createdAt) - new Date(a.createdAt));
  return rows;
}
exports.resultRows = resultRows;

exports.list = async (req, res) => res.json(await resultRows(req.query));

exports.report = async (req, res) => {
  const a = await Attempt.findById(req.params.attemptId).populate('candidate').populate('exam').populate('examSet', 'name').lean();
  if (!a) return res.status(404).json({ message: 'Attempt not found' });
  const [qs, result] = await Promise.all([
    Question.find({ set: a.examSet._id }).sort({ order: 1, createdAt: 1 }).lean(),
    Result.findOne({ attempt: a._id }).lean(),
  ]);
  const siblings = await Result.find({ exam: a.exam._id, status: { $in: ['Pass', 'Fail'] } }).select('exam status obtainedMarks createdAt').lean();
  const ranked = withRanks(siblings);
  const myRank = result ? ranked.find((r) => String(r._id) === String(result._id))?.rank ?? null : null;

  const questions = qs.map((q) => {
    const response = a.responses.find((r) => String(r.question) === String(q._id)) || null;
    const evaluation = (a.evaluations || []).find((e) => String(e.question) === String(q._id)) || null;
    let verdict = 'Unanswered';
    let awarded = 0;
    if (response && hasAnswer(response.answer)) {
      if (['MCQ', 'MULTI_SELECT', 'TRUE_FALSE'].includes(q.type)) {
        const v = evaluateObjective(q, response.answer, a.exam);
        verdict = v.correct ? 'Correct' : 'Incorrect';
        awarded = v.marks;
      } else if (evaluation) {
        verdict = 'Evaluated';
        awarded = evaluation.marks;
      } else verdict = 'Pending';
    }
    return { question: q, response, evaluation, verdict, awarded };
  });

  const { attemptTokenHash, ...attempt } = a;
  res.json({ attempt, result: result ? { ...result, rank: myRank } : null, questions });
};
