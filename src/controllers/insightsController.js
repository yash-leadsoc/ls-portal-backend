const mongoose = require('mongoose');
const User = require('../models/User');
const Domain = require('../models/Domain');
require('../models/Category');
const Document = require('../models/Document');
const Checklist = require('../models/Checklist');
const Writeup = require('../models/Writeup');
const Exercise = require('../models/Exercise');
const MaterialReview = require('../models/MaterialReview');
const ChecklistResponse = require('../models/ChecklistResponse');
const WriteupAnswer = require('../models/WriteupAnswer');
const ExerciseSubmission = require('../models/ExerciseSubmission');
const MockInterview = require('../models/MockInterview');
const ClientInterview = require('../models/ClientInterview');
const AuditLog = require('../models/AuditLog');
const RequestLog = require('../models/RequestLog');
const ApiMetric = require('../models/ApiMetric');
const SystemLog = require('../models/SystemLog');
const UsageDaily = require('../models/UsageDaily');
const escapeRegex = require('../utils/escapeRegex');
const { TZ, dayKey } = require('../utils/time');
const { onlineUsers, processStats, liveMinutes, flushMetrics } = require('../middleware/monitor');
const { dbUsage } = require('../services/alerts');
const { benchInfo } = require('../utils/bench');

const DAY = 24 * 60 * 60 * 1000;
const clampDays = (v, def = 30) => Math.min(Math.max(Number(v) || def, 1), 365);
const since = (days) => new Date(Date.now() - days * DAY);
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const pct = (a, b) => (b ? round1((a / b) * 100) : 0);
const toList = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

function dayRange(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(new Date(Date.now() - i * DAY)));
  return out;
}

function weekStarts(weeks) {
  const out = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  for (let i = weeks - 1; i >= 0; i--) {
    const s = new Date(monday);
    s.setDate(monday.getDate() - i * 7);
    out.push(s);
  }
  return out;
}

function weekly(dates, weeks = 12) {
  const starts = weekStarts(weeks);
  return starts.map((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1] : new Date(8.64e15);
    return {
      week: `${s.getDate()}/${s.getMonth() + 1}`,
      value: dates.filter((d) => d && d >= s && d < e).length,
    };
  });
}

async function workforceData() {
  const [employees, bus, managers, ctos] = await Promise.all([
    User.find({ role: 'employee' })
      .select('name employeeCode jobStatus benchStart deployedAt businessUnit skills preferredLocation assignedDomains active enrolledAt createdAt lastActiveAt lastLoginAt streak')
      .lean(),
    User.find({ role: 'bu' }).select('name category').populate('category', 'name').lean(),
    User.countDocuments({ role: 'manager', active: true }),
    User.countDocuments({ role: 'cto', active: true }),
  ]);
  const buName = {};
  const buCat = {};
  bus.forEach((b) => {
    buName[String(b._id)] = b.name;
    buCat[String(b._id)] = (b.category && b.category.name) || 'Uncategorized';
  });
  return { employees, active: employees.filter((e) => e.active), bus, buName, buCat, managers, ctos };
}

function workforceSection(w) {
  const status = { on_training: 0, ongoing_interview: 0, deployed: 0 };
  const byBU = {};
  const byCategory = {};
  const aging = { '0-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0 };
  const benchList = [];
  const now = Date.now();

  w.active.forEach((e) => {
    status[e.jobStatus] = (status[e.jobStatus] || 0) + 1;
    const bu = w.buName[String(e.businessUnit)] || 'Unassigned';
    byBU[bu] = byBU[bu] || { name: bu, total: 0, bench: 0, deployed: 0 };
    byBU[bu].total += 1;
    const cat = w.buCat[String(e.businessUnit)] || 'Uncategorized';
    byCategory[cat] = (byCategory[cat] || 0) + 1;

    if (e.jobStatus === 'deployed') {
      byBU[bu].deployed += 1;
      return;
    }
    byBU[bu].bench += 1;
    const days = benchInfo(e).benchDays || 0;
    if (days <= 30) aging['0-30 days'] += 1;
    else if (days <= 60) aging['31-60 days'] += 1;
    else if (days <= 90) aging['61-90 days'] += 1;
    else aging['90+ days'] += 1;
    benchList.push({ id: e._id, name: e.name, code: e.employeeCode, status: e.jobStatus, days, bu });
  });

  const bench = status.on_training + status.ongoing_interview;
  const avgBenchDays = benchList.length ? Math.round(benchList.reduce((a, b) => a + b.days, 0) / benchList.length) : 0;

  const joiners = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    joiners.push({
      month: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
      value: w.employees.filter((e) => {
        const t = new Date(e.enrolledAt || e.createdAt);
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}` === key;
      }).length,
    });
  }

  return {
    kpis: {
      totalEngineers: w.active.length,
      inactiveAccounts: w.employees.length - w.active.length,
      bench,
      onTraining: status.on_training,
      ongoingInterview: status.ongoing_interview,
      deployed: status.deployed,
      deploymentRate: pct(status.deployed, w.active.length),
      benchRate: pct(bench, w.active.length),
      avgBenchDays,
      trainers: w.managers,
      businessUnits: w.bus.length,
      ctos: w.ctos,
    },
    byStatus: [
      { name: 'On training', value: status.on_training },
      { name: 'Ongoing interview', value: status.ongoing_interview },
      { name: 'Deployed', value: status.deployed },
    ],
    benchAging: Object.entries(aging).map(([name, value]) => ({ name, value })),
    byBU: Object.values(byBU).sort((a, b) => b.total - a.total),
    byCategory: toList(byCategory),
    newJoiners: joiners,
    longestBench: benchList.sort((a, b) => b.days - a.days).slice(0, 15),
  };
}

async function skillsSection(w) {
  const skills = {};
  const locations = {};
  const domainCount = {};
  w.active.forEach((e) => {
    (e.skills || []).forEach((s) => {
      const k = String(s || '').trim();
      if (!k) return;
      const key = k.toLowerCase();
      skills[key] = skills[key] || { name: k, value: 0 };
      skills[key].value += 1;
    });
    const loc = String(e.preferredLocation || '').trim() || 'Not specified';
    locations[loc] = (locations[loc] || 0) + 1;
    (e.assignedDomains || []).forEach((d) => {
      domainCount[String(d)] = (domainCount[String(d)] || 0) + 1;
    });
  });
  const domains = await Domain.find({ _id: { $in: Object.keys(domainCount) } }).select('name').lean();
  const dName = {};
  domains.forEach((d) => (dName[String(d._id)] = d.name));
  const withoutSkills = w.active.filter((e) => !(e.skills || []).length).length;
  const withoutDomains = w.active.filter((e) => !(e.assignedDomains || []).length).length;

  return {
    topSkills: Object.values(skills).sort((a, b) => b.value - a.value).slice(0, 25),
    distinctSkills: Object.keys(skills).length,
    locations: toList(locations).slice(0, 15),
    domainAssignments: Object.entries(domainCount)
      .map(([id, value]) => ({ name: dName[id] || 'Archived domain', value }))
      .sort((a, b) => b.value - a.value),
    withoutSkills,
    withoutDomains,
  };
}

async function trainingSection(w) {
  const activeIds = w.active.map((e) => e._id);
  const [materials, checklists, writeups, exercises, reviewsByEmp, reviewsByDomain, materialsByDomain, clStats, clStarted, wuByEmp, exByEmp] =
    await Promise.all([
      Document.countDocuments({ active: true }),
      Checklist.countDocuments({ active: true }),
      Writeup.countDocuments({ active: true }),
      Exercise.countDocuments({ active: true }),
      MaterialReview.aggregate([{ $match: { employee: { $in: activeIds } } }, { $group: { _id: '$employee', n: { $sum: 1 } } }]),
      MaterialReview.aggregate([
        { $match: { employee: { $in: activeIds } } },
        { $lookup: { from: 'documents', localField: 'document', foreignField: '_id', as: 'd' } },
        { $unwind: '$d' },
        { $group: { _id: '$d.domain', n: { $sum: 1 } } },
      ]),
      Document.aggregate([{ $match: { active: true } }, { $group: { _id: '$domain', n: { $sum: 1 } } }]),
      ChecklistResponse.aggregate([
        { $match: { employee: { $in: activeIds } } },
        { $unwind: '$responses' },
        {
          $group: {
            _id: null,
            items: { $sum: 1 },
            tried: { $sum: { $cond: ['$responses.tried', 1, 0] } },
            understood: { $sum: { $cond: ['$responses.understood', 1, 0] } },
            proficiency: { $avg: '$responses.proficiency' },
          },
        },
      ]),
      ChecklistResponse.distinct('employee', { employee: { $in: activeIds } }),
      WriteupAnswer.aggregate([
        { $match: { employee: { $in: activeIds } } },
        { $project: { employee: 1, answered: { $size: { $filter: { input: '$answers', as: 'a', cond: { $gt: [{ $strLenCP: { $ifNull: ['$$a.answer', ''] } }, 0] } } } } } },
        { $group: { _id: '$employee', answered: { $sum: '$answered' }, writeups: { $sum: 1 } } },
      ]),
      ExerciseSubmission.aggregate([
        { $match: { employee: { $in: activeIds }, completed: true } },
        { $group: { _id: '$employee', n: { $sum: 1 } } },
      ]),
    ]);

  const assignedPerDomain = {};
  w.active.forEach((e) => (e.assignedDomains || []).forEach((d) => (assignedPerDomain[String(d)] = (assignedPerDomain[String(d)] || 0) + 1)));
  const domIds = [...new Set([...materialsByDomain.map((m) => String(m._id)), ...Object.keys(assignedPerDomain)])];
  const doms = await Domain.find({ _id: { $in: domIds }, active: true }).select('name').lean();
  const revMap = {};
  reviewsByDomain.forEach((r) => (revMap[String(r._id)] = r.n));
  const matMap = {};
  materialsByDomain.forEach((m) => (matMap[String(m._id)] = m.n));
  const domainProgress = doms
    .map((d) => {
      const id = String(d._id);
      const possible = (matMap[id] || 0) * (assignedPerDomain[id] || 0);
      return {
        name: d.name,
        materials: matMap[id] || 0,
        engineers: assignedPerDomain[id] || 0,
        reviews: revMap[id] || 0,
        completion: possible ? Math.min(100, pct(revMap[id] || 0, possible)) : 0,
      };
    })
    .sort((a, b) => b.engineers - a.engineers);

  const score = {};
  const add = (id, k, n) => {
    const key = String(id);
    score[key] = score[key] || { reviews: 0, exercises: 0, writeupAnswers: 0 };
    score[key][k] += n;
  };
  reviewsByEmp.forEach((r) => add(r._id, 'reviews', r.n));
  exByEmp.forEach((r) => add(r._id, 'exercises', r.n));
  wuByEmp.forEach((r) => add(r._id, 'writeupAnswers', r.answered));

  const learners = w.active.map((e) => {
    const s = score[String(e._id)] || { reviews: 0, exercises: 0, writeupAnswers: 0 };
    return {
      id: e._id,
      name: e.name,
      code: e.employeeCode,
      ...s,
      streak: (e.streak && e.streak.current) || 0,
      points: s.reviews + s.exercises * 3 + s.writeupAnswers,
    };
  });
  const cl = clStats[0] || { items: 0, tried: 0, understood: 0, proficiency: 0 };
  const today = dayKey();
  const noProgress = learners.filter((l) => l.points === 0).length;

  return {
    kpis: {
      materials,
      checklists,
      writeups,
      exercises,
      materialReviews: reviewsByEmp.reduce((a, b) => a + b.n, 0),
      exercisesCompleted: exByEmp.reduce((a, b) => a + b.n, 0),
      writeupAnswers: wuByEmp.reduce((a, b) => a + b.answered, 0),
      checklistStarted: clStarted.length,
      checklistTriedRate: pct(cl.tried, cl.items),
      checklistUnderstoodRate: pct(cl.understood, cl.items),
      avgProficiency: round1(cl.proficiency),
      learningToday: w.active.filter((e) => e.streak && e.streak.lastActiveDate === today).length,
      avgStreak: w.active.length ? round1(w.active.reduce((a, e) => a + ((e.streak && e.streak.current) || 0), 0) / w.active.length) : 0,
      noProgress,
    },
    domainProgress,
    topLearners: [...learners].sort((a, b) => b.points - a.points).slice(0, 10),
    lowEngagement: [...learners].sort((a, b) => a.points - b.points).slice(0, 10),
  };
}

async function interviewsSection() {
  const [mocks, clients] = await Promise.all([
    MockInterview.find({}).select('status score scheduledAt forRole').lean(),
    ClientInterview.find({}).select('status client sentAt').lean(),
  ]);
  const mStatus = { scheduled: 0, completed: 0, cancelled: 0 };
  mocks.forEach((m) => (mStatus[m.status] = (mStatus[m.status] || 0) + 1));
  const scores = mocks.filter((m) => m.score != null).map((m) => m.score);
  const buckets = { '0-4': 0, '5-6': 0, '7-8': 0, '9-10': 0 };
  scores.forEach((s) => {
    if (s <= 4) buckets['0-4'] += 1;
    else if (s <= 6) buckets['5-6'] += 1;
    else if (s <= 8) buckets['7-8'] += 1;
    else buckets['9-10'] += 1;
  });
  const roles = {};
  mocks.forEach((m) => {
    const r = (m.forRole || '').trim();
    if (r) roles[r] = (roles[r] || 0) + 1;
  });

  const order = ['sent', 'in_progress', 'selected', 'rejected', 'on_hold'];
  const cStatus = {};
  order.forEach((s) => (cStatus[s] = 0));
  const byClient = {};
  clients.forEach((c) => {
    cStatus[c.status] = (cStatus[c.status] || 0) + 1;
    const k = c.client || 'Unknown';
    byClient[k] = byClient[k] || { name: k, sent: 0, selected: 0 };
    byClient[k].sent += 1;
    if (c.status === 'selected') byClient[k].selected += 1;
  });
  const decided = cStatus.selected + cStatus.rejected;
  const upcoming = mocks.filter((m) => m.status === 'scheduled' && new Date(m.scheduledAt) >= new Date()).length;

  return {
    kpis: {
      mocksTotal: mocks.length,
      mocksScheduled: mStatus.scheduled,
      mocksUpcoming: upcoming,
      mocksCompleted: mStatus.completed,
      mocksCancelled: mStatus.cancelled,
      avgMockScore: scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      passRate: pct(scores.filter((s) => s >= 7).length, scores.length),
      clientSubmissions: clients.length,
      clientSelected: cStatus.selected,
      clientRejected: cStatus.rejected,
      clientInProgress: cStatus.in_progress + cStatus.sent,
      selectionRate: pct(cStatus.selected, decided),
    },
    mockStatus: toList(mStatus),
    scoreDistribution: Object.entries(buckets).map(([name, value]) => ({ name, value })),
    mockTrend: weekly(mocks.map((m) => new Date(m.scheduledAt))),
    clientTrend: weekly(clients.map((c) => new Date(c.sentAt))),
    clientPipeline: order.map((s) => ({ name: s.replace('_', ' '), value: cStatus[s] })),
    topClients: Object.values(byClient).sort((a, b) => b.sent - a.sent).slice(0, 10),
    topRoles: toList(roles).slice(0, 10),
  };
}

async function activitySummary(w, days) {
  const from = since(days);
  const dayFrom = dayKey(from);
  const [dau, logins, wauUsers, mauUsers, todayUsers, failed24] = await Promise.all([
    UsageDaily.aggregate([
      { $match: { day: { $gte: dayFrom } } },
      { $group: { _id: '$day', users: { $addToSet: '$user' }, views: { $sum: '$views' }, ms: { $sum: '$ms' } } },
      { $project: { users: { $size: '$users' }, views: 1, ms: 1 } },
    ]),
    AuditLog.aggregate([
      { $match: { action: { $in: ['login', 'login.failed'] }, createdAt: { $gte: from } } },
      { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, a: '$action' }, n: { $sum: 1 } } },
    ]),
    UsageDaily.distinct('user', { date: { $gte: since(7) } }),
    UsageDaily.distinct('user', { date: { $gte: since(30) } }),
    UsageDaily.distinct('user', { day: dayKey() }),
    AuditLog.countDocuments({ action: 'login.failed', createdAt: { $gte: since(1) } }),
  ]);
  const dauMap = {};
  dau.forEach((d) => (dauMap[d._id] = d));
  const loginMap = {};
  logins.forEach((l) => {
    loginMap[l._id.d] = loginMap[l._id.d] || { success: 0, failed: 0 };
    loginMap[l._id.d][l._id.a === 'login' ? 'success' : 'failed'] = l.n;
  });
  const trend = dayRange(days).map((d) => ({
    date: d.slice(5),
    activeUsers: (dauMap[d] && dauMap[d].users) || 0,
    pageViews: (dauMap[d] && dauMap[d].views) || 0,
    hours: round1(((dauMap[d] && dauMap[d].ms) || 0) / 3600000),
    logins: (loginMap[d] && loginMap[d].success) || 0,
    failedLogins: (loginMap[d] && loginMap[d].failed) || 0,
  }));
  const weekAgo = Date.now() - 7 * DAY;
  const inactive = w.active.filter((e) => !e.lastActiveAt || new Date(e.lastActiveAt).getTime() < weekAgo);

  return {
    kpis: {
      onlineNow: onlineUsers().length,
      activeToday: todayUsers.length,
      activeWeek: wauUsers.length,
      activeMonth: mauUsers.length,
      stickiness: pct(todayUsers.length, mauUsers.length),
      inactiveEngineers7d: inactive.length,
      failedLogins24h: failed24,
    },
    trend,
    inactive: inactive
      .sort((a, b) => new Date(a.lastActiveAt || 0) - new Date(b.lastActiveAt || 0))
      .slice(0, 25)
      .map((e) => ({ id: e._id, name: e.name, code: e.employeeCode, lastActiveAt: e.lastActiveAt, lastLoginAt: e.lastLoginAt })),
  };
}

async function healthSummary() {
  const from = since(1);
  const [metrics, openAlerts, errors24] = await Promise.all([
    ApiMetric.aggregate([
      { $match: { hour: { $gte: from } } },
      { $group: { _id: null, count: { $sum: '$count' }, e5: { $sum: '$errors5xx' }, e4: { $sum: '$errors4xx' }, total: { $sum: '$totalMs' } } },
    ]),
    SystemLog.countDocuments({ level: 'alert', resolvedAt: null }),
    RequestLog.countDocuments({ kind: 'error', status: { $gte: 500 }, at: { $gte: from } }),
  ]);
  const m = metrics[0] || { count: 0, e5: 0, e4: 0, total: 0 };
  let db = null;
  try {
    db = await dbUsage();
  } catch (e) { }
  const p = processStats();
  return {
    requests24h: m.count,
    avgResponseMs: m.count ? Math.round(m.total / m.count) : 0,
    errorRate: pct(m.e5, m.count),
    serverErrors24h: errors24,
    openAlerts,
    dbUsedMb: db ? Math.round(db.usedMb) : null,
    dbUsedPct: db ? round1(db.pct) : null,
    uptimeSec: p.uptimeSec,
    dbConnected: mongoose.connection.readyState === 1,
  };
}

exports.overview = async (req, res) => {
  const days = clampDays(req.query.days, 30);
  const w = await workforceData();
  const [skills, training, interviews, activity, health] = await Promise.all([
    skillsSection(w),
    trainingSection(w),
    interviewsSection(),
    activitySummary(w, days),
    healthSummary(),
  ]);
  res.json({ generatedAt: new Date(), days, workforce: workforceSection(w), skills, training, interviews, activity, health });
};

exports.activity = async (req, res) => {
  const days = clampDays(req.query.days, 30);
  const from = since(days);
  const dayFrom = dayKey(from);
  const w = await workforceData();
  const [summary, pages, users, byRole, byHour, actions] = await Promise.all([
    activitySummary(w, days),
    UsageDaily.aggregate([
      { $match: { day: { $gte: dayFrom } } },
      { $group: { _id: '$path', views: { $sum: '$views' }, ms: { $sum: '$ms' }, users: { $addToSet: '$user' } } },
      { $project: { views: 1, ms: 1, users: { $size: '$users' } } },
      { $sort: { views: -1 } },
      { $limit: 20 },
    ]),
    UsageDaily.aggregate([
      { $match: { day: { $gte: dayFrom } } },
      { $group: { _id: '$user', views: { $sum: '$views' }, ms: { $sum: '$ms' }, days: { $addToSet: '$day' }, role: { $first: '$role' } } },
      { $project: { views: 1, ms: 1, role: 1, days: { $size: '$days' } } },
      { $sort: { ms: -1 } },
      { $limit: 20 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: { views: 1, ms: 1, role: 1, days: 1, name: { $arrayElemAt: ['$u.name', 0] } } },
    ]),
    UsageDaily.aggregate([
      { $match: { day: { $gte: dayFrom } } },
      { $group: { _id: '$role', users: { $addToSet: '$user' }, ms: { $sum: '$ms' } } },
      { $project: { users: { $size: '$users' }, ms: 1 } },
    ]),
    RequestLog.aggregate([
      { $match: { kind: 'mutation', at: { $gte: from } } },
      { $group: { _id: { $hour: { date: '$at', timezone: TZ } }, n: { $sum: 1 } } },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: from } } },
      { $group: { _id: '$action', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 15 },
    ]),
  ]);
  const hourMap = {};
  byHour.forEach((h) => (hourMap[h._id] = h.n));
  res.json({
    ...summary,
    online: onlineUsers(),
    topPages: pages.map((p) => ({ path: p._id, views: p.views, users: p.users, minutes: Math.round(p.ms / 60000) })),
    topUsers: users.map((u) => ({ id: u._id, name: u.name || 'Unknown', role: u.role, views: u.views, days: u.days, minutes: Math.round(u.ms / 60000) })),
    byRole: byRole.map((r) => ({ name: r._id || 'unknown', users: r.users, hours: round1(r.ms / 3600000) })),
    byHour: Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, '0')}:00`, value: hourMap[h] || 0 })),
    topActions: actions.map((a) => ({ name: a._id || 'unknown', value: a.n })),
  });
};

function p95FromBuckets(b) {
  const count = b.reduce((a, n) => a + n, 0);
  if (!count) return 0;
  const target = count * 0.95;
  let acc = 0;
  for (let i = 0; i < b.length; i++) {
    acc += b[i] || 0;
    if (acc >= target) return ApiMetric.BUCKETS[i] === Infinity ? 5000 : ApiMetric.BUCKETS[i];
  }
  return 5000;
}

exports.performance = async (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 30);
  await flushMetrics();
  const from = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await ApiMetric.find({ hour: { $gte: from } }).lean();

  const routes = {};
  const series = {};
  const total = { count: 0, e4: 0, e5: 0, ms: 0, max: 0, b: [0, 0, 0, 0, 0, 0, 0, 0] };
  rows.forEach((r) => {
    const key = `${r.method} ${r.route}`;
    const x = (routes[key] = routes[key] || { method: r.method, route: r.route, count: 0, e4: 0, e5: 0, ms: 0, max: 0, b: [0, 0, 0, 0, 0, 0, 0, 0] });
    [x, total].forEach((t) => {
      t.count += r.count;
      t.e4 += r.errors4xx;
      t.e5 += r.errors5xx;
      t.ms += r.totalMs;
      t.max = Math.max(t.max, r.maxMs);
      for (let i = 0; i < 8; i++) t.b[i] += r[`b${i}`] || 0;
    });
    const hk = new Date(r.hour).toISOString();
    series[hk] = series[hk] || { hour: r.hour, count: 0, errors: 0, ms: 0 };
    series[hk].count += r.count;
    series[hk].errors += r.errors5xx;
    series[hk].ms += r.totalMs;
  });

  res.json({
    hours,
    totals: {
      requests: total.count,
      avgMs: total.count ? Math.round(total.ms / total.count) : 0,
      p95Ms: p95FromBuckets(total.b, total.count),
      maxMs: total.max,
      clientErrors: total.e4,
      serverErrors: total.e5,
      errorRate: pct(total.e5, total.count),
      requestsPerMinute: round1(total.count / (hours * 60)),
    },
    latencyDistribution: total.b.map((n, i) => ({
      name: ApiMetric.BUCKETS[i] === Infinity ? '>5s' : `≤${ApiMetric.BUCKETS[i] >= 1000 ? `${ApiMetric.BUCKETS[i] / 1000}s` : `${ApiMetric.BUCKETS[i]}ms`}`,
      value: n,
    })),
    hourly: Object.values(series)
      .sort((a, b) => new Date(a.hour) - new Date(b.hour))
      .map((s) => ({
        hour: new Date(s.hour).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', hour: '2-digit', hour12: false }),
        requests: s.count,
        errors: s.errors,
        avgMs: s.count ? Math.round(s.ms / s.count) : 0,
      })),
    endpoints: Object.values(routes)
      .map((r) => ({
        method: r.method,
        route: r.route,
        count: r.count,
        avgMs: r.count ? Math.round(r.ms / r.count) : 0,
        p95Ms: p95FromBuckets(r.b, r.count),
        maxMs: r.max,
        clientErrors: r.e4,
        serverErrors: r.e5,
        errorRate: pct(r.e4 + r.e5, r.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50),
    process: processStats(),
    live: liveMinutes(),
  });
};

exports.database = async (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const conn = mongoose.connection;
  const out = { state: states[conn.readyState] || 'unknown', name: conn.name, host: conn.host, limitMb: Number(process.env.DB_STORAGE_LIMIT_MB || 512) };
  if (conn.readyState !== 1) return res.json(out);

  const t0 = process.hrtime.bigint();
  try {
    await conn.db.admin().ping();
    out.pingMs = round1(Number(process.hrtime.bigint() - t0) / 1e6);
  } catch (e) {
    out.pingMs = null;
  }

  try {
    const s = await conn.db.stats();
    out.stats = {
      collections: s.collections,
      objects: s.objects,
      dataMb: round1(s.dataSize / 1048576),
      storageMb: round1(s.storageSize / 1048576),
      indexMb: round1(s.indexSize / 1048576),
      avgObjBytes: Math.round(s.avgObjSize || 0),
    };
    out.usedMb = round1((s.dataSize + s.indexSize) / 1048576);
    out.usedPct = pct(s.dataSize + s.indexSize, out.limitMb * 1048576);
  } catch (e) { }

  const cols = await conn.db.listCollections({}, { nameOnly: true }).toArray();
  out.collections = (
    await Promise.all(
      cols.map(async (c) => {
        const col = conn.db.collection(c.name);
        const row = { name: c.name, count: 0, sizeMb: null, indexMb: null };
        try {
          row.count = await col.estimatedDocumentCount();
        } catch (e) { }
        try {
          const [st] = await col.aggregate([{ $collStats: { storageStats: {} } }]).toArray();
          if (st && st.storageStats) {
            row.sizeMb = round1(st.storageStats.size / 1048576);
            row.indexMb = round1(st.storageStats.totalIndexSize / 1048576);
          }
        } catch (e) { }
        return row;
      })
    )
  ).sort((a, b) => (b.sizeMb || 0) - (a.sizeMb || 0) || b.count - a.count);

  res.json(out);
};

exports.alerts = async (req, res) => {
  const [open, history] = await Promise.all([
    SystemLog.find({ level: 'alert', resolvedAt: null }).sort({ at: -1 }).lean(),
    SystemLog.find({ level: 'alert' }).sort({ at: -1 }).limit(100).lean(),
  ]);
  const w = await workforceData();
  const now = Date.now();
    const longBench = w.active.filter((e) => e.jobStatus !== 'deployed' && (benchInfo(e).benchDays || 0) > 60).length;
  const inactive = w.active.filter((e) => !e.lastActiveAt || now - new Date(e.lastActiveAt).getTime() > 7 * DAY).length;
  const noDomains = w.active.filter((e) => !(e.assignedDomains || []).length).length;
  const overdueMocks = await MockInterview.countDocuments({ status: 'scheduled', scheduledAt: { $lt: new Date(now - DAY) } });

  const observations = [
    longBench && { severity: 'warning', message: `${longBench} engineer(s) have been on the bench for more than 60 days.` },
    inactive && { severity: 'info', message: `${inactive} engineer(s) have not used the portal in the last 7 days.` },
    noDomains && { severity: 'info', message: `${noDomains} engineer(s) have no learning domain assigned.` },
    overdueMocks && { severity: 'warning', message: `${overdueMocks} mock interview(s) are past their date but still marked as scheduled.` },
  ].filter(Boolean);

  res.json({ open, history, observations });
};

const LOG_KINDS = {
  audit: { model: AuditLog, time: 'createdAt', base: {} },
  logins: { model: AuditLog, time: 'createdAt', base: { action: { $in: ['login', 'login.failed', 'logout'] } } },
  errors: { model: RequestLog, time: 'at', base: { kind: 'error' } },
  requests: { model: RequestLog, time: 'at', base: { kind: 'mutation' } },
  system: { model: SystemLog, time: 'at', base: {} },
};

function csvEscape(v) {
  if (v == null) return '';
  let s;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object' && typeof v.toHexString === 'function') s = v.toHexString();
  else s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

exports.logs = async (req, res) => {
  const cfg = LOG_KINDS[req.params.kind];
  if (!cfg) return res.status(404).json({ message: 'Unknown log type' });
  const { q, from, to, action, entity, level, status, role, method, actor } = req.query;
  const filter = { ...cfg.base };

  if (from || to) {
    filter[cfg.time] = {};
    if (from) filter[cfg.time].$gte = new Date(from);
    if (to) {
      const e = new Date(to);
      e.setHours(23, 59, 59, 999);
      filter[cfg.time].$lte = e;
    }
  }
  const rx = q ? new RegExp(escapeRegex(String(q).slice(0, 100)), 'i') : null;

  if (cfg.model === AuditLog) {
    if (action && req.params.kind === 'audit') filter.action = String(action);
    if (action && req.params.kind === 'logins' && ['login', 'login.failed', 'logout'].includes(action)) filter.action = action;
    if (entity) filter.entity = String(entity);
    if (role) filter.actorRole = String(role);
    if (actor && mongoose.isValidObjectId(actor)) filter.actor = actor;
    if (rx) filter.$or = [{ actorName: rx }, { entityLabel: rx }, { ip: rx }, { action: rx }];
  } else if (cfg.model === RequestLog) {
    if (status === '4xx') filter.status = { $gte: 400, $lt: 500 };
    else if (status === '5xx') filter.status = { $gte: 500 };
    else if (status && Number(status)) filter.status = Number(status);
    if (method) filter.method = String(method).toUpperCase();
    if (role) filter.role = String(role);
    if (rx) filter.$or = [{ route: rx }, { path: rx }, { userName: rx }, { error: rx }, { ip: rx }];
  } else {
    if (level) filter.level = String(level);
    if (rx) filter.$or = [{ message: rx }, { source: rx }];
  }

  const isCsv = req.query.format === 'csv';
  const limit = isCsv ? 5000 : Math.min(Number(req.query.limit) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const query = cfg.model.find(filter).sort({ [cfg.time]: -1 }).skip(isCsv ? 0 : (page - 1) * limit).limit(limit);
  if (cfg.model === RequestLog && !isCsv) query.select('-stack');
  const [rows, total] = await Promise.all([query.lean(), isCsv ? Promise.resolve(0) : cfg.model.countDocuments(filter)]);

  if (isCsv) {
    const cols = rows.length ? Object.keys(rows[0]).filter((k) => !['__v', 'stack'].includes(k)) : [];
    const body = [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.kind}-logs.csv"`);
    return res.send(body);
  }
  res.json({ rows, total, page, limit });
};

exports.logDetail = async (req, res) => {
  const cfg = LOG_KINDS[req.params.kind];
  if (!cfg || !mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
  const row = await cfg.model.findById(req.params.id).lean();
  if (!row) return res.status(404).json({ message: 'Not found' });
  res.json({ row });
};

exports.runAlertsNow = async (req, res) => {
  const { runAlerts } = require('../services/alerts');
  await runAlerts();
  res.json({ message: 'Alert check completed' });
};

exports.track = async (req, res) => {
  const raw = typeof req.body.path === 'string' ? req.body.path : '';
  const path = raw.split('?')[0].slice(0, 200).replace(/[0-9a-f]{24}/gi, ':id') || '/';
  const ms = Math.min(Math.max(Number(req.body.ms) || 0, 0), 4 * 60 * 60 * 1000);
  const views = req.body.view ? 1 : 0;
  if (!ms && !views) return res.status(204).end();
  const u = req.user;
  const day = dayKey();
  const date = new Date(`${day}T00:00:00.000Z`);
  await UsageDaily.updateOne(
    { day, user: u._id, path },
    {
      $inc: { views, ms: Math.round(ms) },
      $setOnInsert: { date, role: u.role, businessUnit: u.role === 'bu' ? u._id : u.businessUnit || null },
    },
    { upsert: true }
  );
  res.status(204).end();
};
