const Exam = require('../../models/exam/Exam');
const { sweepExpiredAttempts, repairUnscored } = require('./examSubmit');
const { retryPending } = require('./examAiEvaluator');

async function syncExamStatuses() {
  const now = new Date();
  await Exam.updateMany({ status: { $in: ['Scheduled', 'Live'] }, startsAt: { $gt: now } }, { $set: { status: 'Scheduled' } });
  await Exam.updateMany(
    { status: { $in: ['Scheduled', 'Live'] }, startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    { $set: { status: 'Live' } }
  );
  await Exam.updateMany({ status: { $in: ['Scheduled', 'Live'] }, endsAt: { $lte: now } }, { $set: { status: 'Completed' } });
}

// Runs every 30s: keeps exam statuses in sync with their schedule and
// auto-submits attempts whose timer has expired.
function startExamJobs() {
  const run = async () => {
    try {
      await syncExamStatuses();
      await sweepExpiredAttempts();
      await repairUnscored();
      await retryPending();
    } catch (e) {
      console.error('Exam job failed:', e.message);
    }
  };
  run();
  const t = setInterval(run, 30 * 1000);
  if (t.unref) t.unref();
  return t;
}

module.exports = { syncExamStatuses, startExamJobs };
