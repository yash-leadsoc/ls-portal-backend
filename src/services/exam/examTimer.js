// Saves are accepted for a few seconds after expiry so the candidate's last
// keystrokes (flushed right before auto-submit) are not lost.
const SAVE_GRACE_MS = 5000;

exports.createExpiry = (startedAt, durationMinutes) =>
  new Date(new Date(startedAt).getTime() + durationMinutes * 60000);

exports.remainingSeconds = (expiresAt) =>
  Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));

exports.isExpired = (attempt) =>
  !!attempt.expiresAt && Date.now() >= new Date(attempt.expiresAt).getTime();

exports.assertActive = (attempt) => {
  if (!attempt.startedAt || attempt.status !== 'In Progress') {
    throw Object.assign(new Error('Attempt is not active'), { status: 409 });
  }
  if (Date.now() >= new Date(attempt.expiresAt).getTime() + SAVE_GRACE_MS) {
    throw Object.assign(new Error('Exam time has expired'), { status: 409 });
  }
};
