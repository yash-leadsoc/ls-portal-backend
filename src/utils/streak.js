const User = require('../models/User');

function istDay(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

async function bumpStreak(userId) {
  try {
    const u = await User.findById(userId).select('role streak');
    if (!u || u.role !== 'employee') return;
    const today = istDay();
    const s = u.streak || { current: 0, longest: 0, lastActiveDate: null, activeDays: [] };

    if (s.lastActiveDate === today) return;

    if (s.lastActiveDate && daysBetween(s.lastActiveDate, today) === 1) {
      s.current = (s.current || 0) + 1;
    } else {
      s.current = 1;
    }
    s.longest = Math.max(s.longest || 0, s.current);
    s.lastActiveDate = today;
    s.activeDays = Array.from(new Set([...(s.activeDays || []), today])).slice(-400);

    u.streak = s;
    await u.save();
  } catch (e) {
  }
}

function streakView(u) {
  const s = (u && u.streak) || { current: 0, longest: 0, lastActiveDate: null, activeDays: [] };
  const today = istDay();
  let current = s.current || 0;
  if (s.lastActiveDate && s.lastActiveDate !== today && daysBetween(s.lastActiveDate, today) > 1) {
    current = 0;
  }
  return { current, longest: s.longest || 0, lastActiveDate: s.lastActiveDate || null, activeDays: s.activeDays || [] };
}

module.exports = { bumpStreak, streakView, istDay };
