const DAY = 24 * 60 * 60 * 1000;

function parseDate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return d;
}

function benchInfo(u = {}) {
  const start = u.benchStart || u.enrolledAt || u.createdAt || null;
  const deployed = u.jobStatus === 'deployed';
  const end = deployed ? u.deployedAt || null : new Date();
  let benchDays = null;
  if (start && end) {
    benchDays = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / DAY));
  }
  const benchBucket =
    benchDays == null ? null : benchDays <= 30 ? '0-30' : benchDays <= 60 ? '31-60' : benchDays <= 90 ? '61-90' : '90+';
  return {
    benchStart: start,
    benchStartSet: !!u.benchStart,
    deployedAt: u.deployedAt || null,
    onBench: !deployed,
    benchDays,
    benchBucket,
  };
}

module.exports = { benchInfo, parseDate, DAY };