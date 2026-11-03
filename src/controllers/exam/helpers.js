const crypto = require('crypto');
const Candidate = require('../../models/exam/ExamCandidate');
const Set = require('../../models/exam/ExamSet');

exports.newCandidateId = async () => {
  const year = new Date().getFullYear();
  for (let i = 0; i < 8; i++) {
    const id = `LS-EXAM-${year}-${crypto.randomInt(1, 999999).toString().padStart(6, '0')}`;
    if (!(await Candidate.exists({ candidateId: id }))) return id;
  }
  throw new Error('Could not allocate candidate ID');
};
exports.newAttemptId = () => `LSA-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
exports.newAttemptToken = () => crypto.randomBytes(32).toString('hex');
exports.hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

exports.assignSet = async (examId) => {
  const sets = await Set.find({ exam: examId, isActive: true, 'questions.0': { $exists: true } });
  if (!sets.length) throw Object.assign(new Error('This examination has no question paper configured yet'), { status: 400 });
  return sets[crypto.randomInt(sets.length)];
};

// An exam is open to candidates when it is Live and inside its (optional) window.
exports.availableFilter = (now = new Date()) => ({
  status: 'Live',
  $and: [
    { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
  ],
});

exports.pick = (obj = {}, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

// Deterministic per-attempt shuffle so a refresh shows the same order.
function seededShuffle(arr, seed) {
  let s = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  const rnd = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
exports.seededShuffle = seededShuffle;

exports.publicQuestion = (q) => ({
  id: q._id,
  title: q.title,
  description: q.description,
  images: q.images || [],
  type: q.type,
  options: q.options,
  marks: q.marks,
  order: q.order,
});
