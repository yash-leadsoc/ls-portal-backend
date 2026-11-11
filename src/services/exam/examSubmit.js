const Attempt = require('../../models/exam/ExamAttempt');
const Candidate = require('../../models/exam/ExamCandidate');
const Result = require('../../models/exam/ExamResult');
const { evaluateObjective, hasAnswer } = require('./examEvaluator');
const { sendSubmissionEmail } = require('./examEmail');
const { FINAL, OBJECTIVE } = require('./examConstants');
const { aiAvailable, evaluateAttempt } = require('./examAiEvaluator');
const { invalidateAttemptAuth } = require('../../middleware/examAuth');
const { getScoringKey, getExamFresh } = require('./examCache');

/**
 * Scores a claimed (already final) attempt and writes the Result row. Idempotent:
 * safe to run again by the repair sweeper. Because saves are rejected once the
 * status has left 'In Progress', `claimed.responses` is final here, so every
 * answer the server acknowledged is part of the score.
 */
async function scoreAndRecord(claimed) {
  const [exam, candidate, questions] = await Promise.all([
    getExamFresh(claimed.exam),
    Candidate.findById(claimed.candidate).lean(),
    getScoringKey(claimed.examSet),
  ]);

  const byQ = new Map((claimed.responses || []).map((x) => [String(x.question), x]));
  let score = 0;
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  let pending = false;
  for (const q of questions) {
    const r = byQ.get(String(q._id));
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

  await Attempt.updateOne(
    { _id: claimed._id },
    { $set: { objectiveScore: score, obtainedMarks: score, evaluationPending: pending, scoring: 'done' } }
  );

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
  return { candidate };
}

/**
 * Finalises an attempt exactly once (safe against double-submits, the expiry
 * sweeper and a violation auto-submit racing each other).
 *  auto   - true when the system, not the candidate, ended the exam
 *  reason - 'TIME_EXPIRED' | 'PROCTORING_VIOLATIONS'
 *
 * Order matters: CLAIM first (atomic status flip, after which no further save is
 * accepted), THEN score the now-immutable responses.
 */
async function finalizeAttempt(attempt, { auto = false, reason = null } = {}) {
  const cur = await Attempt.findById(attempt._id).select('status').lean();
  if (!cur) throw Object.assign(new Error('Attempt not found'), { status: 404 });
  if (FINAL.includes(cur.status)) return Attempt.findById(attempt._id);
  if (cur.status !== 'In Progress') {
    throw Object.assign(new Error('Examination has not been started'), { status: 409 });
  }

  // Atomic claim: only one caller wins. `scoring: 'pending'` lets the sweeper
  // repair an attempt if the process dies between here and scoring.
  const claimed = await Attempt.findOneAndUpdate(
    { _id: attempt._id, status: 'In Progress' },
    {
      $set: {
        status: auto ? 'Auto Submitted' : 'Submitted',
        autoSubmitted: auto,
        autoSubmitReason: auto ? reason : null,
        submittedAt: new Date(),
        evaluationPending: true,
        scoring: 'pending',
      },
    },
    { new: true }
  );
  invalidateAttemptAuth(claimed ? claimed.attemptId : attempt.attemptId);
  if (!claimed) return Attempt.findById(attempt._id);

  const { candidate } = await scoreAndRecord(claimed);
  if (candidate) sendSubmissionEmail(claimed, candidate).catch(() => {});
  return claimed;
}

// Re-scores attempts that were claimed but never finished scoring (process crash).
// Only touches attempts flagged scoring:'pending', which legacy records never have.
async function repairUnscored() {
  const rows = await Attempt.find({ scoring: 'pending', submittedAt: { $lt: new Date(Date.now() - 60 * 1000) } }).limit(50);
  for (const a of rows) {
    try {
      await scoreAndRecord(a);
    } catch (e) {
      console.error('Exam score repair failed for', a.attemptId, e.message);
    }
  }
  return rows.length;
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

module.exports = { finalizeAttempt, sweepExpiredAttempts, repairUnscored, FINAL };
