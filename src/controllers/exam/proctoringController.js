const mongoose = require('mongoose');
const Attempt = require('../../models/exam/ExamAttempt');
const Candidate = require('../../models/exam/ExamCandidate');
const Exam = require('../../models/exam/Exam');
const Event = require('../../models/exam/ExamProctoringEvent');
const Session = require('../../models/exam/ExamProctoringSession');
const audit = require('../../services/exam/examAudit');
const escapeRegex = require('../../utils/escapeRegex');
const TtlCache = require('../../utils/ttlCache');
const { SEVERITY, REVIEW_STATUS, CASE_STATUS, validateEventBatch, MAX_EVENTS_PER_ATTEMPT } = require('../../services/exam/proctoringPolicy');

const OID = /^[a-f0-9]{24}$/i;
const UPSERT = { upsert: true, new: true, setDefaultsOnInsert: false };
const FLAGGED = ['Needs Review', 'Under Review', 'Escalated'];
const CAMERA_FROM_EVENT = { CAMERA_DISCONNECTED: 'disconnected', CAMERA_PERMISSION_DENIED: 'denied' };

// Per-attempt running event total (learned from the session $inc result) so the
// hard cap needs no extra DB read. Bounded; resets on restart (rate limit still applies).
const totals = new TtlCache({ ttlMs: 30 * 60 * 1000, max: 5000 });

/* ========================================================================== */
/*  CANDIDATE SIDE  (mounted under /api/exam/attempts/:attemptId/proctoring)   */
/* ========================================================================== */

/**
 * PUT /session   - consent, camera pre-check result, accommodation request.
 * All values are the candidate's own attestations about their own session; none
 * of them can touch review state or another attempt.
 */
exports.updateSession = async (req, res) => {
  const a = req.examAttempt;
  if (!['Registered', 'In Progress'].includes(a.status)) return res.status(409).json({ message: 'Attempt is not active' });
  const cfg = req.proctoringConfig;
  const b = req.body || {};
  const $set = {};
  const now = new Date();

  if (b.consent !== undefined) {
    if (typeof b.consent !== 'boolean') return res.status(400).json({ message: 'Invalid consent value' });
    if (b.consent && b.consentVersion !== cfg.consentVersion) return res.status(400).json({ message: 'Please review the current consent notice.' });
    $set['consent.given'] = b.consent;
    $set['consent.version'] = cfg.consentVersion;
    $set['consent.at'] = now;
  }

  if (b.camera !== undefined) {
    const state = b.camera?.state;
    if (!['ok', 'denied', 'unavailable', 'disconnected'].includes(state)) return res.status(400).json({ message: 'Invalid camera state' });
    $set['camera.state'] = state;
    $set['camera.updatedAt'] = now;
    if (state === 'ok' && b.camera.faceDetected === true) $set['camera.precheckPassedAt'] = now;
  }

  if (b.accommodation !== undefined) {
    const reason = String(b.accommodation?.reason || '').trim().slice(0, 500);
    if (reason.length < 5) return res.status(400).json({ message: 'Please briefly describe why you need an alternative arrangement.' });
    // A decision already taken by an administrator cannot be re-opened by the candidate.
    const existing = await Session.findOne({ attempt: a._id }).select('accommodation.status').lean();
    if (['Approved', 'Denied'].includes(existing?.accommodation?.status)) {
      return res.status(409).json({ message: `Your request has already been ${existing.accommodation.status.toLowerCase()}.` });
    }
    $set['accommodation.status'] = 'Pending';
    $set['accommodation.reason'] = reason;
    $set['accommodation.requestedAt'] = now;
  }

  if (!Object.keys($set).length) return res.status(400).json({ message: 'Nothing to update' });

  const s = await Session.findOneAndUpdate(
    { attempt: a._id },
    { $setOnInsert: { attempt: a._id, candidate: a.candidate, exam: a.exam, createdAt: now }, $set },
    { ...UPSERT, projection: 'consent camera accommodation' }
  ).lean();

  res.json({
    consentGiven: !!(s.consent?.given && s.consent.version === cfg.consentVersion),
    cameraState: s.camera?.state || 'unknown',
    precheckPassed: !!s.camera?.precheckPassedAt,
    accommodation: s.accommodation?.status || 'None',
  });
};

/**
 * POST /events - batched, idempotent, validated.
 * Each event is an upsert keyed by (attempt, clientEventId): retries and the
 * "episode ended, here is the duration" follow-up never create duplicates.
 */
exports.ingest = async (req, res) => {
  const a = req.examAttempt;
  if (!['Registered', 'In Progress'].includes(a.status)) return res.status(409).json({ message: 'Attempt is not active', closed: true });

  const { events, rejected, error } = validateEventBatch(req.body, {
    attemptCreatedAt: a.createdAt ? new Date(a.createdAt).getTime() : 0,
    config: req.proctoringConfig,
  });
  if (error) return res.status(400).json({ message: error });
  if (!events.length) return res.json({ accepted: 0, inserted: 0, rejected });

  if ((totals.get(a.attemptId) || 0) >= MAX_EVENTS_PER_ATTEMPT) return res.json({ accepted: 0, inserted: 0, rejected: events.length, capped: true });

  const now = new Date();
  const ops = events.map((e) => {
    const update = {
      $setOnInsert: {
        candidate: a.candidate,
        exam: a.exam,
        type: e.type,
        severity: SEVERITY[e.type] || 'LOW',
        source: 'client',
        'review.status': 'Pending',
        createdAt: now,
        ...(e.meta ? { meta: e.meta } : {}),
      },
      $min: { at: e.at },
    };
    const max = {};
    if (e.durationMs !== undefined) max.durationMs = e.durationMs;
    if (e.confidence !== undefined) max.confidence = e.confidence;
    if (Object.keys(max).length) update.$max = max;
    return { updateOne: { filter: { attempt: a._id, clientEventId: e.clientEventId }, update, upsert: true } };
  });

  const bw = await Event.bulkWrite(ops, { ordered: false });
  const insertedIdx = Object.keys(bw.upsertedIds || {}).map(Number);
  if (insertedIdx.length) {
    const inc = { eventTotal: insertedIdx.length };
    let medium = false;
    let camera = null;
    let lastAt = events[insertedIdx[0]].at;
    for (const i of insertedIdx) {
      const e = events[i];
      inc[`counts.${e.type}`] = (inc[`counts.${e.type}`] || 0) + 1;
      if (SEVERITY[e.type] === 'MEDIUM') medium = true;
      if (CAMERA_FROM_EVENT[e.type]) camera = CAMERA_FROM_EVENT[e.type];
      if (e.at > lastAt) lastAt = e.at;
    }
    const update = {
      $setOnInsert: { attempt: a._id, candidate: a.candidate, exam: a.exam, createdAt: now },
      $inc: inc,
      $max: { lastEventAt: lastAt },
    };
    if (camera) update.$set = { 'camera.state': camera, 'camera.updatedAt': now };
    const s = await Session.findOneAndUpdate({ attempt: a._id }, update, { ...UPSERT, projection: 'eventTotal' }).lean();
    totals.set(a.attemptId, s?.eventTotal || 0);

    // First medium-severity indicator moves a clear case to "Needs Review" (never beyond).
    if (medium) {
      await Session.updateOne(
        { attempt: a._id, $or: [{ 'review.status': 'Clear' }, { 'review.status': { $exists: false } }] },
        { $set: { 'review.status': 'Needs Review', 'review.at': now } }
      );
    }
  }
  res.json({ accepted: events.length, inserted: insertedIdx.length, rejected });
};

/* ========================================================================== */
/*  ADMIN SIDE  (mounted under /api/exam/admin/proctoring, requireExamAdmin)   */
/* ========================================================================== */

const examFilter = (q) => (q.exam && OID.test(String(q.exam)) ? { exam: new mongoose.Types.ObjectId(String(q.exam)) } : {});

exports.overview = async (req, res) => {
  const f = examFilter(req.query);
  const [totalCandidates, inProgress, flagged, withEvents, pendingAccommodations, ev] = await Promise.all([
    Attempt.countDocuments(f),
    Attempt.countDocuments({ ...f, status: 'In Progress' }),
    Session.countDocuments({ ...f, 'review.status': { $in: FLAGGED } }),
    Session.countDocuments({ ...f, eventTotal: { $gt: 0 } }),
    Session.countDocuments({ ...f, 'accommodation.status': 'Pending' }),
    Session.aggregate([{ $match: f }, { $group: { _id: null, n: { $sum: '$eventTotal' } } }]),
  ]);
  res.json({
    totalCandidates,
    currentlyTaking: inProgress,
    noSuspiciousEvents: Math.max(0, totalCandidates - withEvents),
    flaggedForReview: flagged,
    totalEvents: ev[0]?.n || 0,
    pendingAccommodations,
  });
};

const countsView = (c = {}) => ({
  tabSwitches: c.TAB_SWITCH || 0,
  windowBlurs: c.WINDOW_BLUR || 0,
  fullscreenExits: c.FULLSCREEN_EXIT || 0,
  faceMissing: c.FACE_NOT_DETECTED || 0,
  multipleFaces: c.MULTIPLE_FACES || 0,
  headAway: c.HEAD_DIRECTION_AWAY || 0,
  clipboard: (c.COPY_ATTEMPT || 0) + (c.CUT_ATTEMPT || 0) + (c.PASTE_ATTEMPT || 0),
  cameraIssues: (c.CAMERA_DISCONNECTED || 0) + (c.CAMERA_PERMISSION_DENIED || 0),
});

exports.candidates = async (req, res) => {
  const f = examFilter(req.query);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const page = Math.max(1, Number(req.query.page) || 1);
  const filter = { ...f };

  if (req.query.attemptStatus) filter.status = String(req.query.attemptStatus).slice(0, 30);
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 80)), 'i');
    const ids = await Candidate.find({ ...f, $or: [{ name: rx }, { email: rx }, { candidateId: rx }] }).select('_id').limit(500).lean();
    filter.candidate = { $in: ids.map((c) => c._id) };
  }
  if (req.query.review && CASE_STATUS.includes(req.query.review)) {
    if (req.query.review === 'Clear') {
      // "Clear" = everyone who is not in any other case state (including attempts that never produced a session).
      const open = await Session.find({ ...f, 'review.status': { $in: CASE_STATUS.filter((x) => x !== 'Clear') } }).select('attempt').limit(5000).lean();
      filter._id = { $nin: open.map((s) => s.attempt) };
    } else {
      const ss = await Session.find({ ...f, 'review.status': req.query.review }).select('attempt').limit(2000).lean();
      filter._id = { $in: ss.map((s) => s.attempt) };
    }
  }

  const attempts = await Attempt.find(filter)
    .select('attemptId candidate exam status startedAt submittedAt createdAt')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  const aIds = attempts.map((a) => a._id);
  const [cands, exams, sessions] = await Promise.all([
    Candidate.find({ _id: { $in: attempts.map((a) => a.candidate) } }).select('name candidateId email').lean(),
    Exam.find({ _id: { $in: [...new Set(attempts.map((a) => String(a.exam)))] } }).select('name').lean(),
    Session.find({ attempt: { $in: aIds } }).select('attempt counts eventTotal lastEventAt camera.state review accommodation.status consent.given').lean(),
  ]);
  const cm = new Map(cands.map((c) => [String(c._id), c]));
  const em = new Map(exams.map((e) => [String(e._id), e]));
  const sm = new Map(sessions.map((s) => [String(s.attempt), s]));

  res.json({
    page,
    limit,
    rows: attempts.map((a) => {
      const s = sm.get(String(a._id));
      const c = cm.get(String(a.candidate));
      return {
        attemptId: a.attemptId,
        candidateName: c?.name || '—',
        candidateId: c?.candidateId || '—',
        examName: em.get(String(a.exam))?.name || '—',
        attemptStatus: a.status,
        startedAt: a.startedAt || null,
        counts: countsView(s?.counts),
        eventTotal: s?.eventTotal || 0,
        lastEventAt: s?.lastEventAt || null,
        consentGiven: !!s?.consent?.given,
        cameraState: s?.camera?.state || 'unknown',
        accommodation: s?.accommodation?.status || 'None',
        reviewStatus: s?.review?.status || 'Clear',
      };
    }),
  });
};

exports.candidateDetail = async (req, res) => {
  const a = await Attempt.findOne({ attemptId: String(req.params.attemptId) }).select('attemptId candidate exam status startedAt submittedAt autoSubmitted autoSubmitReason violationCount').lean();
  if (!a) return res.status(404).json({ message: 'Attempt not found' });
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500));
  const type = req.query.type && /^[A-Z_]{3,30}$/.test(req.query.type) ? { type: req.query.type } : {};
  const [candidate, exam, session, events] = await Promise.all([
    Candidate.findById(a.candidate).select('name candidateId email').lean(),
    Exam.findById(a.exam).select('name aiProctoring.enabled').lean(),
    Session.findOne({ attempt: a._id }).lean(),
    Event.find({ attempt: a._id, ...type }).sort({ at: 1 }).limit(limit).select('type severity at durationMs confidence meta review createdAt').lean(),
  ]);
  res.json({
    attempt: a,
    candidate,
    exam,
    session: session ? { ...session, counts: countsView(session.counts), rawCounts: session.counts || {} } : null,
    events,
    truncated: events.length === limit,
  });
};

exports.reviewEvent = async (req, res) => {
  if (!OID.test(req.params.eventId)) return res.status(400).json({ message: 'Invalid event' });
  const status = req.body?.status;
  if (!REVIEW_STATUS.includes(status)) return res.status(400).json({ message: 'Invalid review status' });
  const note = req.body?.note === undefined ? undefined : String(req.body.note).trim().slice(0, 1000);
  const $set = { 'review.status': status, 'review.by': req.examAdmin._id, 'review.at': new Date() };
  if (note !== undefined) $set['review.note'] = note;
  const ev = await Event.findByIdAndUpdate(req.params.eventId, { $set }, { new: true, projection: 'exam attempt type review' }).lean();
  if (!ev) return res.status(404).json({ message: 'Event not found' });
  await audit(req, 'PROCTORING_EVENT_REVIEWED', ev.exam, { event: String(ev._id), attempt: String(ev.attempt), type: ev.type, status });
  res.json({ review: ev.review });
};

exports.setCase = async (req, res) => {
  const status = req.body?.status;
  if (!CASE_STATUS.includes(status)) return res.status(400).json({ message: 'Invalid case status' });
  // Reviewers may only mark a case "Under Review"; closing or escalating requires the admin role.
  if (status !== 'Under Review' && (req.examAdmin.role || 'admin') !== 'admin') {
    return res.status(403).json({ message: 'Only an Exam Admin can resolve or escalate a case.' });
  }
  const a = await Attempt.findOne({ attemptId: String(req.params.attemptId) }).select('candidate exam').lean();
  if (!a) return res.status(404).json({ message: 'Attempt not found' });
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (['Resolved', 'Escalated'].includes(status) && note.length < 3) return res.status(400).json({ message: 'Add a short note explaining the decision.' });

  const now = new Date();
  const s = await Session.findOneAndUpdate(
    { attempt: a._id },
    { $setOnInsert: { attempt: a._id, candidate: a.candidate, exam: a.exam, createdAt: now }, $set: { 'review.status': status, 'review.note': note, 'review.by': req.examAdmin._id, 'review.at': now } },
    { ...UPSERT, projection: 'review' }
  ).lean();
  await audit(req, 'PROCTORING_CASE_UPDATED', a.exam, { attempt: String(a._id), status });
  res.json({ review: s.review });
};

exports.accommodations = async (req, res) => {
  const f = examFilter(req.query);
  const status = ['Pending', 'Approved', 'Denied'].includes(req.query.status) ? req.query.status : 'Pending';
  const rows = await Session.find({ ...f, 'accommodation.status': status }).sort({ 'accommodation.requestedAt': 1 }).limit(200).select('attempt candidate exam accommodation').lean();
  const [cands, atts] = await Promise.all([
    Candidate.find({ _id: { $in: rows.map((r) => r.candidate) } }).select('name candidateId').lean(),
    Attempt.find({ _id: { $in: rows.map((r) => r.attempt) } }).select('attemptId').lean(),
  ]);
  const cm = new Map(cands.map((c) => [String(c._id), c]));
  const am = new Map(atts.map((x) => [String(x._id), x.attemptId]));
  res.json(rows.map((r) => ({ attemptId: am.get(String(r.attempt)), candidateName: cm.get(String(r.candidate))?.name, candidateId: cm.get(String(r.candidate))?.candidateId, ...r.accommodation })));
};

exports.decideAccommodation = async (req, res) => {
  const decision = req.body?.decision;
  if (!['Approved', 'Denied'].includes(decision)) return res.status(400).json({ message: 'Decision must be Approved or Denied' });
  const a = await Attempt.findOne({ attemptId: String(req.params.attemptId) }).select('exam').lean();
  if (!a) return res.status(404).json({ message: 'Attempt not found' });
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const s = await Session.findOneAndUpdate(
    { attempt: a._id, 'accommodation.status': { $in: ['Pending', 'Approved', 'Denied'] } },
    { $set: { 'accommodation.status': decision, 'accommodation.decidedBy': req.examAdmin._id, 'accommodation.decidedAt': new Date(), 'accommodation.decisionNote': note } },
    { new: true, projection: 'accommodation' }
  ).lean();
  if (!s) return res.status(404).json({ message: 'No accommodation request found for this attempt' });
  await audit(req, 'PROCTORING_ACCOMMODATION_DECIDED', a.exam, { attempt: String(a._id), decision });
  res.json({ accommodation: s.accommodation });
};
