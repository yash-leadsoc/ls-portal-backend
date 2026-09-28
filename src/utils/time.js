const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';

function formatDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-IN', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dayKey(d = new Date()) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
}

module.exports = { TZ, formatDateTime, dayKey };
