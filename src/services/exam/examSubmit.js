const Attempt = require('../../models/exam/ExamAttempt');
const Exam = require('../../models/exam/Exam');
const Candidate = require('../../models/exam/ExamCandidate');
const Question = require('../../models/exam/ExamQuestion');
const Result = require('../../models/exam/ExamResult');
const { evaluateObjective, hasAnswer } = require('./examEvaluator');
const { sendSubmissionEmail } = require('./examEmail');
const { FINAL, OBJECTIVE } = require('./examConstants');
const { aiAvailable, evaluateAttempt } = require('./examAiEvaluator');

/**
 * Finalises an attempt exactly once (safe against double-submits, the expiry
 * sweeper and a violation auto-submit racing each other).
 *  auto   - true when the system, not the candidate, ended the exam
 *  reason - 'TIME_EXPIRED' | 'PROCTORING_VIOLATIONS'
 */
async function finalizeAttempt(attempt, { auto = false, reason = null } = {}) {
  const fresh = await Attempt.findById(attempt._id);
  if (!fresh) throw Object.assign(new Error('Attempt not found'), { status: 404 });
  if (FINAL.includes(fresh.status)) return fresh;
  if (fresh.status !== 'In Progress') {
    throw Object.assign(new Error('Examination has not been started'), { status: 409 });
  }

  const [exam, candidate, questions] = await Promise.all([
    Exam.findById(fresh.exam),
    Candidate.findById(fresh.candidate),
    Question.find({ set: fresh.examSet }),
  ]);

  let score = 0;
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  let pending = false;
  for (const q of questions) {
    const r = fresh.responses.find((x) => String(x.question) === String(q._id));
    if (!r || !hasAnswer(r.answer)) {
      unanswered++;
      continue;
    }
    if (OBJECTIVE.includes(q.type)) {
      const v = evaluateObjective(q, r.answer, exam || {});
      score += v.marks;
      if (v.correct) correct++;
      else incorrect++;
    } else {
      pending = true;
    }
  }
  score = Math.max(0, score);

  // Atomic claim: only one caller wins.
  const claimed = await Attempt.findOneAndUpdate(
    { _id: fresh._id, status: 'In Progress' },
    {
      $set: {
        status: auto ? 'Auto Submitted' : 'Submitted',
        autoSubmitted: auto,
        autoSubmitReason: auto ? reason : null,
        submittedAt: new Date(),
        objectiveScore: score,
        obtainedMarks: score,
        evaluationPending: pending,
      },
    },
    { new: true }
  );
  if (!claimed) return Attempt.findById(fresh._id);

  const maximumMarks = exam?.maximumMarks || 0;
  await Result.findOneAndUpdate(
    { attempt: claimed._id },
    {
      attempt: claimed._id,
      candidate: claimed.candidate,
      exam: claimed.exam,
      maximumMarks,
      obtainedMarks: score,
      percentage: maximumMarks ? (score / maximumMarks) * 100 : 0,
      correctAnswers: correct,
      incorrectAnswers: incorrect,
      unanswered,
      status: pending ? 'Pending Evaluation' : score >= (exam?.passingMarks || 0) ? 'Pass' : 'Fail',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Written answers: grade them with AI in the background (the candidate is not kept waiting).
  if (pending) {
    const ai = aiAvailable(exam);
    await Attempt.updateOne({ _id: claimed._id }, { $set: { 'aiEvaluation.status': ai ? 'pending' : 'skipped' } });
    if (ai) setImmediate(() => evaluateAttempt(claimed._id).catch((e) => console.error('AI evaluation failed:', e.message)));
  }

  if (candidate) sendSubmissionEmail(claimed, candidate).catch(() => {});
  return claimed;
}

// Auto-submits attempts whose time ran out (e.g. candidate closed the browser).
async function sweepExpiredAttempts() {
  const rows = await Attempt.find({ status: 'In Progress', expiresAt: { $lte: new Date() } }).limit(200);
  for (const a of rows) {
    try {
      await finalizeAttempt(a, { auto: true, reason: 'TIME_EXPIRED' });
    } catch (e) {
      console.error('Exam sweep failed for', a.attemptId, e.message);
    }
  }
  return rows.length;
}

module.exports = { finalizeAttempt, sweepExpiredAttempts, FINAL };
