const Attempt = require('../../models/exam/ExamAttempt');
const Exam = require('../../models/exam/Exam');
const Question = require('../../models/exam/ExamQuestion');
const Result = require('../../models/exam/ExamResult');
const rank = require('./examRanking');
const { hasAnswer } = require('./examEvaluator');
const { FINAL, DESCRIPTIVE } = require('./examConstants');

/**
 * Recomputes an attempt's total score, evaluation state and Result from the
 * stored objective score + all descriptive evaluations (AI and manual).
 * Used after every evaluation so the result/score is always current.
 */
async function recompute(attemptId) {
  const a = await Attempt.findById(attemptId);
  if (!a) return null;
  const [exam, questions] = await Promise.all([
    Exam.findById(a.exam),
    Question.find({ set: a.examSet, type: { $in: DESCRIPTIVE } }),
  ]);

  let descriptive = 0;
  let pending = false;
  for (const q of questions) {
    const resp = a.responses.find((r) => String(r.question) === String(q._id));
    if (!resp || !hasAnswer(resp.answer)) continue;
    const ev = a.evaluations.find((e) => String(e.question) === String(q._id));
    if (ev) descriptive += ev.marks;
    else pending = true;
  }
  const total = Math.max(0, (a.objectiveScore || 0) + descriptive);

  const set = { obtainedMarks: total, evaluationPending: pending };
  if (FINAL.includes(a.status)) set.status = pending ? (a.evaluations.length ? 'Under Evaluation' : a.status) : 'Evaluated';
  await Attempt.updateOne({ _id: a._id }, { $set: set });

  const max = exam?.maximumMarks || 0;
  const result = await Result.findOneAndUpdate(
    { attempt: a._id },
    {
      obtainedMarks: total,
      percentage: max ? (total / max) * 100 : 0,
      status: pending ? 'Pending Evaluation' : total >= (exam?.passingMarks || 0) ? 'Pass' : 'Fail',
    },
    { new: true }
  );
  await rank(a.exam);
  return { result, total, pending };
}

module.exports = { recompute };
