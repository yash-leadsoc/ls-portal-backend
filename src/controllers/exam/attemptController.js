const Attempt = require('../../models/exam/ExamAttempt');
const Exam = require('../../models/exam/Exam');
const Candidate = require('../../models/exam/ExamCandidate');
const Question = require('../../models/exam/ExamQuestion');
const { createExpiry, remainingSeconds, assertActive, isExpired } = require('../../services/exam/examTimer');
const { finalizeAttempt, FINAL } = require('../../services/exam/examSubmit');
const { publicQuestion, seededShuffle } = require('./helpers');

const MAX_TEXT = 10000;
const proctoring = (exam, attempt) => ({
  enabled: exam.proctoringEnabled !== false,
  maxWarnings: exam.maxWarnings ?? 3,
  violationCount: attempt.violationCount || 0,
});
const finalState = (a) => ({
  status: a.status,
  autoSubmitted: !!a.autoSubmitted,
  reason: a.autoSubmitReason || null,
});

exports.instructions = async (req, res) => {
  const a = req.examAttempt;
  const [exam, candidate] = await Promise.all([
    Exam.findById(a.exam).select('name durationMinutes maximumMarks passingMarks instructions proctoringEnabled maxWarnings negativeMarking'),
    Candidate.findById(a.candidate).select('name candidateId'),
  ]);
  if (!exam) return res.status(404).json({ message: 'Examination no longer exists' });
  res.json({
    exam,
    candidate,
    proctoring: proctoring(exam, a),
    status: a.status,
    expiresAt: a.expiresAt,
    remainingSeconds: a.expiresAt ? remainingSeconds(a.expiresAt) : null,
  });
};

exports.start = async (req, res) => {
  const a = req.examAttempt;

  // Idempotent resume (page refresh on the instructions screen, etc.)
  if (a.status === 'In Progress') {
    if (isExpired(a)) {
      const r = await finalizeAttempt(a, { auto: true, reason: 'TIME_EXPIRED' });
      return res.status(409).json({ message: 'Your exam time has expired', ...finalState(r) });
    }
    return res.json({ startedAt: a.startedAt, expiresAt: a.expiresAt, remainingSeconds: remainingSeconds(a.expiresAt), resumed: true });
  }
  if (a.status !== 'Registered') return res.status(409).json({ message: 'This attempt has already been completed', status: a.status });

  const exam = await Exam.findById(a.exam);
  if (!exam) return res.status(404).json({ message: 'Examination no longer exists' });
  if (exam.status !== 'Live') return res.status(400).json({ message: 'This examination is not currently live' });
  const now = new Date();
  if ((exam.startsAt && now < exam.startsAt) || (exam.endsAt && now > exam.endsAt)) {
    return res.status(400).json({ message: 'Exam is outside its scheduled window' });
  }

  const expiresAt = createExpiry(now, exam.durationMinutes);
  const started = await Attempt.findOneAndUpdate(
    { _id: a._id, status: 'Registered' },
    { $set: { status: 'In Progress', startedAt: now, expiresAt, lastHeartbeat: now } },
    { new: true }
  );
  if (!started) return res.status(409).json({ message: 'Attempt already started' });
  res.json({ startedAt: started.startedAt, expiresAt: started.expiresAt, remainingSeconds: remainingSeconds(started.expiresAt) });
};

exports.paper = async (req, res) => {
  const a = req.examAttempt;
  if (FINAL.includes(a.status)) return res.status(409).json({ message: 'This examination has already been submitted', ...finalState(a) });
  if (a.status !== 'In Progress') return res.status(409).json({ message: 'Attempt is not active', status: a.status });
  if (isExpired(a)) {
    const r = await finalizeAttempt(a, { auto: true, reason: 'TIME_EXPIRED' });
    return res.status(410).json({ message: 'Time expired', ...finalState(r) });
  }

  const exam = await Exam.findById(a.exam);
  let qs = await Question.find({ set: a.examSet }).sort({ order: 1, createdAt: 1 });
  if (exam.randomizeQuestions) qs = seededShuffle(qs, `${a.attemptId}:q`);
  const questions = qs.map((q) => {
    const p = publicQuestion(q);
    if (exam.randomizeOptions && ['MCQ', 'MULTI_SELECT'].includes(q.type)) {
      p.options = seededShuffle(q.options || [], `${a.attemptId}:${q._id}`);
    }
    return p;
  });

  await Attempt.updateOne({ _id: a._id }, { $set: { lastHeartbeat: new Date() }, $inc: { refreshCount: 1 } });
  res.json({
    exam: { name: exam.name, maximumMarks: exam.maximumMarks, durationMinutes: exam.durationMinutes },
    questions,
    responses: a.responses.map((r) => ({ question: r.question, answer: r.answer, markedForReview: r.markedForReview })),
    expiresAt: a.expiresAt,
    remainingSeconds: remainingSeconds(a.expiresAt),
    proctoring: proctoring(exam, a),
  });
};

function validAnswer(q, answer) {
  if (answer === null || answer === undefined || answer === '') return true; // clearing
  if (q.type === 'MCQ') return typeof answer === 'string' && q.options.some((o) => o.value === answer);
  if (q.type === 'TRUE_FALSE') return answer === 'true' || answer === 'false';
  if (q.type === 'MULTI_SELECT') {
    return Array.isArray(answer) && answer.length <= 26 && answer.every((v) => q.options.some((o) => o.value === v));
  }
  return typeof answer === 'string' && answer.length <= (q.type === 'SHORT_ANSWER' ? 1000 : MAX_TEXT);
}

exports.save = async (req, res) => {
  const a = req.examAttempt;
  try {
    assertActive(a);
  } catch (e) {
    if (a.status === 'In Progress') await finalizeAttempt(a, { auto: true, reason: 'TIME_EXPIRED' }).catch(() => {});
    return res.status(409).json({ message: e.message, status: a.status });
  }

  const { questionId, answer, markedForReview } = req.body || {};
  const q = await Question.findOne({ _id: questionId, set: a.examSet });
  if (!q) return res.status(404).json({ message: 'Question not found' });
  if (!validAnswer(q, answer)) return res.status(400).json({ message: 'Invalid answer for this question' });

  const now = new Date();
  const value = answer === undefined ? null : answer;
  // Atomic updates: parallel saves never collide on the document version.
  const upd = await Attempt.updateOne(
    { _id: a._id, 'responses.question': q._id },
    { $set: { 'responses.$.answer': value, 'responses.$.markedForReview': !!markedForReview, 'responses.$.savedAt': now, lastHeartbeat: now } }
  );
  if (!upd.matchedCount) {
    await Attempt.updateOne(
      { _id: a._id, 'responses.question': { $ne: q._id } },
      { $push: { responses: { question: q._id, answer: value, markedForReview: !!markedForReview, savedAt: now } }, $set: { lastHeartbeat: now } }
    );
  }
  res.json({ saved: true, savedAt: now });
};

exports.status = async (req, res) => {
  let a = req.examAttempt;
  if (a.status === 'In Progress' && isExpired(a)) a = await finalizeAttempt(a, { auto: true, reason: 'TIME_EXPIRED' });
  res.json({ ...finalState(a), expiresAt: a.expiresAt, remainingSeconds: a.expiresAt ? remainingSeconds(a.expiresAt) : null });
};

// The candidate left the exam window (minimised, switched tab or application).
// The server is authoritative: warnings 1..maxWarnings are just recorded; the
// next violation auto-submits the examination.
exports.violation = async (req, res) => {
  const a = req.examAttempt;
  const exam = await Exam.findById(a.exam).select('maxWarnings proctoringEnabled');
  const max = exam?.maxWarnings ?? 3;

  if (a.status !== 'In Progress') {
    return res.json({ counted: false, count: a.violationCount, max, remaining: 0, ...finalState(a), finished: FINAL.includes(a.status) });
  }
  if (exam && exam.proctoringEnabled === false) {
    return res.json({ counted: false, count: a.violationCount, max, remaining: max, finished: false });
  }

  // Collapse the blur + visibilitychange pair of a single tab switch.
  const last = a.violations?.[a.violations.length - 1];
  if (last?.at && Date.now() - new Date(last.at).getTime() < 1500) {
    return res.json({ counted: false, duplicate: true, count: a.violationCount, max, remaining: Math.max(0, max - a.violationCount), finished: false });
  }

  const kind = ['TAB_HIDDEN', 'WINDOW_BLUR'].includes(req.body?.kind) ? req.body.kind : 'OTHER';
  const upd = await Attempt.findOneAndUpdate(
    { _id: a._id, status: 'In Progress' },
    {
      $inc: { violationCount: 1 },
      $push: { violations: { $each: [{ kind, at: new Date(), detail: String(req.body?.detail || '').slice(0, 200) }], $slice: -50 } },
    },
    { new: true }
  );
  if (!upd) return res.json({ counted: false, count: a.violationCount, max, remaining: 0, finished: true, ...finalState(await Attempt.findById(a._id)) });

  if (upd.violationCount > max) {
    const r = await finalizeAttempt(upd, { auto: true, reason: 'PROCTORING_VIOLATIONS' });
    return res.json({ counted: true, count: upd.violationCount, max, remaining: 0, finished: true, ...finalState(r) });
  }
  res.json({ counted: true, count: upd.violationCount, max, remaining: max - upd.violationCount, finished: false });
};

// The candidate's own score, only when the exam allows it (exam.showResultToCandidate).
exports.result = async (req, res) => {
  const a = req.examAttempt;
  const exam = await Exam.findById(a.exam).select('showResultToCandidate maximumMarks passingMarks');
  if (!exam?.showResultToCandidate) return res.json({ visible: false });
  if (!FINAL.includes(a.status)) return res.json({ visible: true, ready: false, state: 'in_progress' });
  if (a.evaluationPending) {
    const ai = a.aiEvaluation?.status;
    return res.json({ visible: true, ready: false, state: ai === 'pending' || ai === 'running' ? 'evaluating' : 'review' });
  }
  const max = exam.maximumMarks || 0;
  res.json({
    visible: true, ready: true, obtainedMarks: a.obtainedMarks, maximumMarks: max,
    percentage: max ? (a.obtainedMarks / max) * 100 : 0, passingMarks: exam.passingMarks || 0, passed: a.obtainedMarks >= (exam.passingMarks || 0),
  });
};

exports.submit = async (req, res) => {
  const a = req.examAttempt;
  if (a.status === 'Registered') return res.status(409).json({ message: 'The examination has not been started' });
  const expired = a.status === 'In Progress' && isExpired(a);
  const r = await finalizeAttempt(a, { auto: expired, reason: expired ? 'TIME_EXPIRED' : null });
  const candidate = await Candidate.findById(r.candidate).select('candidateId');
  res.json({ message: 'Examination received', candidateId: candidate?.candidateId, ...finalState(r) });
};
