const mongoose = require('mongoose');
const Attempt = require('../../models/exam/ExamAttempt');
const Exam = require('../../models/exam/Exam');
const Candidate = require('../../models/exam/ExamCandidate');
const ProctoringSession = require('../../models/exam/ExamProctoringSession');
const { createExpiry, remainingSeconds, isExpired, SAVE_GRACE_MS } = require('../../services/exam/examTimer');
const { finalizeAttempt, FINAL } = require('../../services/exam/examSubmit');
const { seededShuffle } = require('./helpers');
const { getExam, getSet } = require('../../services/exam/examCache');
const { validAnswer, parseSeq } = require('../../services/exam/answerValidation');
const { effectiveConfig } = require('../../services/exam/proctoringPolicy');
const { invalidateAttemptAuth } = require('../../middleware/examAuth');

const OID = /^[a-f0-9]{24}$/i;

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

/**
 * Server-side enforcement of the AI-proctoring pre-conditions (consent + camera
 * check, or an approved accommodation). Returns null when the candidate may
 * start, otherwise a description of what is missing.
 */
async function proctoringGate(attempt, exam) {
  const cfg = effectiveConfig(exam.aiProctoring);
  if (!cfg.enabled) return null;
  const s = await ProctoringSession.findOne({ attempt: attempt._id }).select('consent camera accommodation').lean();
  const accommodated = s?.accommodation?.status === 'Approved';
  const consent = !!(s?.consent?.given && s.consent.version === cfg.consentVersion);
  const camera = !cfg.cameraRequired || accommodated || (s?.camera?.state === 'ok' && !!s?.camera?.precheckPassedAt);
  if (consent && camera) return null;
  return { consent, camera, accommodation: s?.accommodation?.status || 'None' };
}

exports.instructions = async (req, res) => {
  const a = req.examAttempt;
  const [exam, candidate] = await Promise.all([
    Exam.findById(a.exam).select('name durationMinutes maximumMarks passingMarks instructions proctoringEnabled maxWarnings negativeMarking aiProctoring').lean(),
    Candidate.findById(a.candidate).select('name candidateId').lean(),
  ]);
  if (!exam) return res.status(404).json({ message: 'Examination no longer exists' });

  const cfg = effectiveConfig(exam.aiProctoring);
  let aiSession = null;
  if (cfg.enabled) {
    const s = await ProctoringSession.findOne({ attempt: a._id }).select('consent camera accommodation').lean();
    aiSession = {
      consentGiven: !!(s?.consent?.given && s.consent.version === cfg.consentVersion),
      cameraState: s?.camera?.state || 'unknown',
      precheckPassed: !!s?.camera?.precheckPassedAt,
      accommodation: s?.accommodation?.status || 'None',
      accommodationDecisionNote: s?.accommodation?.status === 'Denied' ? s.accommodation.decisionNote || null : null,
    };
  }
  const { aiProctoring, ...examOut } = exam;
  res.json({
    exam: examOut,
    candidate,
    proctoring: proctoring(exam, a),
    aiProctoring: cfg.enabled ? { config: cfg, session: aiSession } : { config: { enabled: false } },
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

  const exam = await Exam.findById(a.exam).lean(); // authoritative read, never the cache
  if (!exam) return res.status(404).json({ message: 'Examination no longer exists' });
  if (exam.status !== 'Live') return res.status(400).json({ message: 'This examination is not currently live' });
  const now = new Date();
  if ((exam.startsAt && now < exam.startsAt) || (exam.endsAt && now > exam.endsAt)) {
    return res.status(400).json({ message: 'Exam is outside its scheduled window' });
  }

  const missing = await proctoringGate(a, exam);
  if (missing) {
    return res.status(403).json({
      code: 'PROCTORING_REQUIREMENTS',
      message: 'Complete the consent and camera check (or get an accommodation approved) before starting.',
      requirements: missing,
    });
  }

  const expiresAt = createExpiry(now, exam.durationMinutes);
  const started = await Attempt.findOneAndUpdate(
    { _id: a._id, status: 'Registered' },
    { $set: { status: 'In Progress', startedAt: now, expiresAt, lastHeartbeat: now } },
    { new: true, projection: 'startedAt expiresAt' }
  ).lean();
  if (!started) return res.status(409).json({ message: 'Attempt already started' });
  invalidateAttemptAuth(a.attemptId);
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

  // The question set + exam settings are shared by every candidate of the exam and
  // are served from a short single-flight cache; only this candidate's answers are
  // read per request. The answer key is never part of the cached paper.
  const [exam, set, mine] = await Promise.all([
    getExam(a.exam),
    getSet(a.examSet),
    Attempt.findById(a._id).select('responses').lean(),
  ]);
  if (!exam) return res.status(404).json({ message: 'Examination no longer exists' });

  let qs = set.paper;
  if (exam.randomizeQuestions) qs = seededShuffle(qs, `${a.attemptId}:q`);
  const questions = qs.map((p) => {
    if (exam.randomizeOptions && ['MCQ', 'MULTI_SELECT'].includes(p.type)) {
      return { ...p, options: seededShuffle(p.options || [], `${a.attemptId}:${p.id}`) };
    }
    return p;
  });

  await Attempt.updateOne({ _id: a._id }, { $set: { lastHeartbeat: new Date() }, $inc: { refreshCount: 1 } });
  res.json({
    exam: { name: exam.name, maximumMarks: exam.maximumMarks, durationMinutes: exam.durationMinutes },
    questions,
    responses: (mine?.responses || []).map((r) => ({ question: r.question, answer: r.answer, markedForReview: r.markedForReview, seq: r.seq || 0 })),
    expiresAt: a.expiresAt,
    remainingSeconds: remainingSeconds(a.expiresAt),
    proctoring: proctoring(exam, a),
    aiProctoring: effectiveConfig(exam.aiProctoring),
  });
};

/**
 * Autosave. Designed for the hot path: in steady state this is ONE database
 * operation (the auth lookup and question metadata come from short caches).
 *
 * Integrity rules, all enforced inside the atomic UPDATE filter so they hold
 * even when the cached view is stale or requests race:
 *  - the attempt must still be 'In Progress' and inside expiry + grace;
 *  - a save only lands if its seq is newer than the stored one (stale/duplicate
 *    requests are acknowledged but do not overwrite newer answers);
 *  - the answer is validated against the question's type/options server-side.
 */
exports.save = async (req, res) => {
  const a = req.examAttempt;
  const { questionId, answer, markedForReview } = req.body || {};

  if (typeof questionId !== 'string' || !OID.test(questionId)) return res.status(400).json({ message: 'Invalid question' });
  if (markedForReview !== undefined && typeof markedForReview !== 'boolean') return res.status(400).json({ message: 'Invalid review flag' });

  const set = await getSet(a.examSet);
  const meta = set.meta.get(questionId);
  if (!meta) return res.status(404).json({ message: 'Question not found' });
  if (!validAnswer(meta, answer)) return res.status(400).json({ message: 'Invalid answer for this question' });

  const now = new Date();
  const seq = parseSeq(req.body.seq) ?? now.getTime(); // legacy clients: server time
  const value = answer === undefined ? null : answer;
  const review = !!markedForReview;
  const qOid = new mongoose.Types.ObjectId(questionId);
  const live = { _id: a._id, status: 'In Progress', expiresAt: { $gt: new Date(now.getTime() - SAVE_GRACE_MS) } };

  const overwrite = () =>
    Attempt.updateOne(
      { ...live, responses: { $elemMatch: { question: qOid, $or: [{ seq: { $lt: seq } }, { seq: null }] } } },
      { $set: { 'responses.$.answer': value, 'responses.$.markedForReview': review, 'responses.$.savedAt': now, 'responses.$.seq': seq, lastHeartbeat: now } }
    );

  // 1) overwrite an existing response if our seq is newer (or it predates seq)
  if ((await overwrite()).matchedCount) return res.json({ saved: true, savedAt: now, seq });

  // 2) first answer for this question
  const ins = await Attempt.updateOne(
    { ...live, 'responses.question': { $ne: qOid } },
    { $push: { responses: { question: qOid, answer: value, markedForReview: review, savedAt: now, seq } }, $set: { lastHeartbeat: now } }
  );
  if (ins.matchedCount) return res.json({ saved: true, savedAt: now, seq });

  // 2b) a concurrent first-save (e.g. second tab) created the entry between steps 1 and 2:
  //     try the overwrite once more so the newer seq still wins.
  if ((await overwrite()).matchedCount) return res.json({ saved: true, savedAt: now, seq });

  // 3) nothing matched: either a newer/identical save already exists, or the attempt is no longer writable.
  const fresh = await Attempt.findById(a._id).select('status expiresAt').lean();
  if (fresh && fresh.status === 'In Progress' && !isExpired(fresh)) {
    return res.json({ saved: true, stale: true, savedAt: now, seq }); // acknowledged, NOT applied (newer data kept)
  }
  if (fresh && fresh.status === 'In Progress') {
    const r = await finalizeAttempt(a, { auto: true, reason: 'TIME_EXPIRED' }).catch(() => null);
    return res.status(409).json({ message: 'Exam time has expired', status: r?.status || 'Auto Submitted' });
  }
  return res.status(409).json({ message: 'Attempt is not active', status: fresh?.status || a.status });
};

exports.status = async (req, res) => {
  let a = req.examAttempt;
  if (a.status === 'In Progress' && isExpired(a)) a = await finalizeAttempt(a, { auto: true, reason: 'TIME_EXPIRED' });
  res.json({ ...finalState(a), expiresAt: a.expiresAt, remainingSeconds: a.expiresAt ? remainingSeconds(a.expiresAt) : null });
};

// The candidate left the exam window (minimised, switched tab or application).
// The server is authoritative: warnings 1..maxWarnings are just recorded; the
// next violation auto-submits the examination.
//
// NOTE: this is the PRE-EXISTING browser-focus policy and is unchanged. It is
// independent of AI proctoring: events from the AI pipeline never feed it.
exports.violation = async (req, res) => {
  const a = req.examAttempt;
  const exam = await Exam.findById(a.exam).select('maxWarnings proctoringEnabled').lean();
  const max = exam?.maxWarnings ?? 3;

  if (a.status !== 'In Progress') {
    return res.json({ counted: false, count: a.violationCount, max, remaining: 0, ...finalState(a), finished: FINAL.includes(a.status) });
  }
  if (exam && exam.proctoringEnabled === false) {
    return res.json({ counted: false, count: a.violationCount, max, remaining: max, finished: false });
  }

  // Collapse the blur + visibilitychange pair of a single tab switch.
  // const last = a.violations?.[a.violations.length - 1];
  // if (last?.at && Date.now() - new Date(last.at).getTime() < 1500) {
  //   return res.json({ counted: false, duplicate: true, count: a.violationCount, max, remaining: Math.max(0, max - a.violationCount), finished: false });
  // }

const ALLOWED_VIOLATIONS = [
  'TAB_HIDDEN',
  'WINDOW_BLUR',
  'FACE_NOT_DETECTED',
  'MULTIPLE_FACES',
  'HEAD_DIRECTION_AWAY',
];

const kind = ALLOWED_VIOLATIONS.includes(req.body?.kind)
  ? req.body.kind
  : 'OTHER';

const last = a.violations?.[a.violations.length - 1];

const isFocusDuplicate =
  ['TAB_HIDDEN', 'WINDOW_BLUR'].includes(kind) &&
  ['TAB_HIDDEN', 'WINDOW_BLUR'].includes(last?.kind);
if (
  isFocusDuplicate &&
  last?.at &&
  Date.now() - new Date(last.at).getTime() < 1500
) {
  return res.json({
    counted: false,
    duplicate: true,
    count: a.violationCount,
    max,
    remaining: Math.max(0, max - a.violationCount),
    finished: false
  });
}

  // const kind = ['TAB_HIDDEN', 'WINDOW_BLUR'].includes(req.body?.kind) ? req.body.kind : 'OTHER';
//   const ALLOWED_VIOLATIONS = [
//   'TAB_HIDDEN',
//   'WINDOW_BLUR',
//   'FACE_NOT_DETECTED',
//   'MULTIPLE_FACES',
//   'HEAD_DIRECTION_AWAY',
// ];

// const kind = ALLOWED_VIOLATIONS.includes(req.body?.kind)
//   ? req.body.kind
//   : 'OTHER';
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
  const exam = await Exam.findById(a.exam).select('showResultToCandidate maximumMarks passingMarks').lean();
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
  const candidate = await Candidate.findById(r.candidate).select('candidateId').lean();
  res.json({ message: 'Examination received', candidateId: candidate?.candidateId, ...finalState(r) });
};
