const Exam = require('../../models/exam/Exam');
const Question = require('../../models/exam/ExamQuestion');
const TtlCache = require('../../utils/ttlCache');
const { publicQuestion } = require('../../controllers/exam/helpers');

/**
 * Read-mostly data that every candidate of an exam fetches (the question set,
 * option values, the exam settings). Cached briefly and single-flighted so 200
 * candidates opening the paper at the same moment cost ~1 DB read, not 200.
 *
 * Correct answers are NEVER placed in the cache entries that can reach a
 * candidate response: `paper` holds publicQuestion() output only, `meta` holds
 * type + option values only.
 */
const TTL = Number(process.env.EXAM_CACHE_MS || 30000);
const examCache = new TtlCache({ ttlMs: Math.min(TTL, 10000), max: 200 });
const setCache = new TtlCache({ ttlMs: TTL, max: 200 });
const inflight = new Map();

function singleFlight(key, loader) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(loader)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function getExam(examId) {
  const key = String(examId);
  const hit = examCache.get(key);
  if (hit) return hit;
  return singleFlight(`exam:${key}`, async () => {
    const e = await Exam.findById(examId).lean();
    if (e) examCache.set(key, e);
    return e;
  });
}

/** { paper: [publicQuestion...], meta: Map<qid,{type,optionValues:Set}> } */
async function getSet(setId) {
  const key = String(setId);
  const hit = setCache.get(key);
  if (hit) return hit;
  return singleFlight(`set:${key}`, async () => {
    const qs = await Question.find({ set: setId }).sort({ order: 1, createdAt: 1 }).lean();
    const meta = new Map();
    const paper = qs.map((q) => {
      meta.set(String(q._id), { type: q.type, optionValues: new Set((q.options || []).map((o) => o.value)) });
      return publicQuestion(q);
    });
    return setCache.set(key, { paper, meta });
  });
}

/**
 * Answer key for scoring. NOT cached over time (an admin correcting the key must
 * take effect immediately) - only concurrent identical reads are merged, so 200
 * simultaneous submissions of the same set cost one read instead of 200.
 */
const getScoringKey = (setId) => singleFlight(`key:${setId}`, () => Question.find({ set: setId }).lean());
const getExamFresh = (examId) => singleFlight(`examfresh:${examId}`, () => Exam.findById(examId).lean());

const invalidateSet = (setId) => setCache.delete(String(setId));
const invalidateExam = (examId) => examCache.delete(String(examId));

module.exports = { getExam, getSet, getScoringKey, getExamFresh, invalidateSet, invalidateExam };
