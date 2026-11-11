function planGoLive({ exam, newEndsAt, noEndTime = false, now = new Date() }) {
  if (exam.status === 'Archived') return { ok: false, error: 'This exam is archived. Change it to Draft first, then go live.' };

  const ended = exam.endsAt && new Date(exam.endsAt) <= now;
  const update = { status: 'Live' };

  if (noEndTime === true) {
    update.endsAt = null;
  } else if (newEndsAt !== undefined && newEndsAt !== null && newEndsAt !== '') {
    const d = new Date(newEndsAt);
    if (isNaN(d)) return { ok: false, error: 'Invalid end time.' };
    if (d <= now) return { ok: false, error: 'The new end time must be in the future.' };
    if (exam.startsAt && d <= new Date(exam.startsAt)) return { ok: false, error: 'The end time must be after the start time.' };
    update.endsAt = d;
  } else if (ended) {
    return { ok: false, needsEndTime: true, error: 'This exam’s end time has passed. Choose a new end time (or "no end time") to re-open it.' };
  }

  const startsInFuture = exam.startsAt && new Date(exam.startsAt) > now;
  return { ok: true, update, note: startsInFuture ? 'The exam has a start time in the future, so it will show as Scheduled until then. Clear the start time in Edit to open it immediately.' : null };
}

module.exports = { planGoLive };