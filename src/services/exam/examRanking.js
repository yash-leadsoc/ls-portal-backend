const Result = require('../../models/exam/ExamResult');

// Competition ranking ("1,2,2,4") over Pass/Fail results only.
function withRanks(rows) {
  const byExam = new Map();
  for (const r of rows) {
    if (!['Pass', 'Fail'].includes(r.status)) {
      r.rank = null;
      continue;
    }
    const k = String(r.exam?._id || r.exam);
    if (!byExam.has(k)) byExam.set(k, []);
    byExam.get(k).push(r);
  }
  for (const list of byExam.values()) {
    list.sort((a, b) => b.obtainedMarks - a.obtainedMarks || new Date(a.createdAt) - new Date(b.createdAt));
    let rank = 0;
    let last = null;
    list.forEach((r, i) => {
      if (last === null || r.obtainedMarks !== last) rank = i + 1;
      last = r.obtainedMarks;
      r.rank = rank;
    });
  }
  return rows;
}

// Persists ranks for an exam (used by the admin "Recalculate ranks" action).
async function recalculate(examId) {
  const rows = await Result.find({ exam: examId, status: { $in: ['Pass', 'Fail'] } }).lean();
  withRanks(rows);
  const ops = rows.map((r) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { rank: r.rank } } } }));
  if (ops.length) await Result.bulkWrite(ops);
  await Result.updateMany({ exam: examId, status: 'Pending Evaluation' }, { $unset: { rank: 1 } });
  return rows.length;
}

module.exports = recalculate;
module.exports.withRanks = withRanks;
