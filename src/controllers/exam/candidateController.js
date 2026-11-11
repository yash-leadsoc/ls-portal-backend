const Candidate = require('../../models/exam/ExamCandidate');
const Exam = require('../../models/exam/Exam');
const Attempt = require('../../models/exam/ExamAttempt');
const Result = require('../../models/exam/ExamResult');
const escapeRegex = require('../../utils/escapeRegex');
const { invalidateAttemptAuth } = require('../../middleware/examAuth');
const { newCandidateId, newAttemptId, newAttemptToken, hashToken, assignSet, availableFilter } = require('./helpers');

const attemptMeta = (req) => ({ ipAddress: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) });

exports.register = async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim();
  const { examId } = req.body || {};
  if (name.length < 2 || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || !/^[+\d][\d\s()-]{7,19}$/.test(phone)) {
    return res.status(400).json({ message: 'Enter a valid name, email and phone number' });
  }

  const exam = await Exam.findOne({ _id: examId, ...availableFilter() });
  if (!exam) return res.status(400).json({ message: 'Exam is not currently available' });

  let candidate = await Candidate.findOne({ exam: examId, email });
  if (candidate) {
    const prior = await Attempt.find({ candidate: candidate._id, exam: examId }).sort({ createdAt: -1 });
    const open = prior[0];
    // Not started yet (e.g. tab was closed on the instructions page): let the
    // same person continue, verified by the phone number they registered with.
    if (open && open.status === 'Registered' && candidate.phone === phone) {
      const attemptToken = newAttemptToken();
      await Attempt.updateOne({ _id: open._id }, { $set: { attemptTokenHash: hashToken(attemptToken), ...attemptMeta(req) } });
      invalidateAttemptAuth(open.attemptId); // old token must stop working immediately
      return res.status(200).json({
        candidateId: candidate.candidateId,
        attemptId: open.attemptId,
        attemptToken,
        resumed: true,
        exam: { name: exam.name, durationMinutes: exam.durationMinutes, maximumMarks: exam.maximumMarks },
      });
    }
    if (!exam.allowMultipleAttempts) {
      return res.status(409).json({
        message: open && open.status === 'In Progress'
          ? 'Your examination is already in progress on another window. Please contact your examination coordinator.'
          : 'You have already registered for this examination',
      });
    }
  } else {
    try {
      candidate = await Candidate.create({ candidateId: await newCandidateId(), name, email, phone, exam: examId });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ message: 'You have already registered for this examination' });
      throw e;
    }
  }

  const set = await assignSet(examId);
  const attemptToken = newAttemptToken();
  const attempt = await Attempt.create({
    attemptId: newAttemptId(),
    candidate: candidate._id,
    exam: examId,
    examSet: set._id,
    attemptTokenHash: hashToken(attemptToken),
    ...attemptMeta(req),
  });
  res.status(201).json({
    candidateId: candidate.candidateId,
    attemptId: attempt.attemptId,
    attemptToken,
    exam: { name: exam.name, durationMinutes: exam.durationMinutes, maximumMarks: exam.maximumMarks },
  });
};

async function candidateRows(query) {
  const filter = {};
  if (query.exam) filter.exam = query.exam;
  if (query.q) {
    const rx = new RegExp(escapeRegex(String(query.q).slice(0, 80)), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { candidateId: rx }, { phone: rx }];
  }
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if ((from && !isNaN(from)) || (to && !isNaN(to))) {
    filter.createdAt = {};
    if (from && !isNaN(from)) filter.createdAt.$gte = from;
    if (to && !isNaN(to)) filter.createdAt.$lte = to;
  }
  const rows = await Candidate.find(filter).populate('exam', 'name').sort({ createdAt: -1 }).limit(2000).lean();
  const ids = rows.map((r) => r._id);
  const [attempts, results] = await Promise.all([
    Attempt.find({ candidate: { $in: ids } })
      .select('candidate status violationCount autoSubmitted submittedAt createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    Result.find({ candidate: { $in: ids } }).select('candidate attempt status percentage obtainedMarks maximumMarks').lean(),
  ]);
  const latest = new Map();
  for (const a of attempts) if (!latest.has(String(a.candidate))) latest.set(String(a.candidate), a);
  const resByAttempt = new Map(results.map((r) => [String(r.attempt), r]));
  return rows.map((c) => {
    const attempt = latest.get(String(c._id)) || null;
    return { ...c, attempt, result: attempt ? resByAttempt.get(String(attempt._id)) || null : null };
  });
}
exports.candidateRows = candidateRows;

exports.list = async (req, res) => res.json(await candidateRows(req.query));
