const mongoose = require('mongoose');
const SystemLog = require('../models/SystemLog');
const RequestLog = require('../models/RequestLog');
const ApiMetric = require('../models/ApiMetric');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { notifyUsers } = require('./pushNotification');
const { processStats } = require('../middleware/monitor');

const num = (name, def) => Number(process.env[name] || def);

const LIMITS = {
  errors5xx15m: () => num('ALERT_5XX_15M', 10),
  failedLogins15m: () => num('ALERT_FAILED_LOGINS_15M', 10),
  failedLoginsPerSource15m: () => num('ALERT_FAILED_LOGINS_PER_SOURCE_15M', 5),
  slowAvgMs: () => num('ALERT_SLOW_AVG_MS', 1500),
  dbWarnPct: () => num('ALERT_DB_WARN_PCT', 80),
  dbCritPct: () => num('ALERT_DB_CRIT_PCT', 90),
  memPct: () => num('ALERT_MEMORY_PCT', 90),
  loopLagMs: () => num('ALERT_EVENT_LOOP_MS', 500),
  dbLimitMb: () => num('DB_STORAGE_LIMIT_MB', 512),
};

async function dbUsage() {
  const stats = await mongoose.connection.db.stats();
  const usedMb = (stats.dataSize + stats.indexSize) / 1048576;
  return { usedMb, pct: (usedMb / LIMITS.dbLimitMb()) * 100 };
}

async function evaluate() {
  const found = [];
  const since15 = new Date(Date.now() - 15 * 60 * 1000);
  const since60 = new Date(Date.now() - 60 * 60 * 1000);

  if (mongoose.connection.readyState !== 1) {
    found.push({ key: 'db.disconnected', severity: 'critical', message: 'Database connection is down.' });
    return found;
  }

  const errors5xx = await RequestLog.countDocuments({ at: { $gte: since15 }, status: { $gte: 500 } });
  if (errors5xx >= LIMITS.errors5xx15m()) {
    found.push({
      key: 'api.errors5xx',
      severity: 'critical',
      message: `${errors5xx} server errors (5xx) in the last 15 minutes.`,
      meta: { count: errors5xx },
    });
  }

  const failed = await AuditLog.aggregate([
    { $match: { action: 'login.failed', createdAt: { $gte: since15 } } },
    { $group: { _id: '$ip', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  const failedTotal = failed.reduce((a, b) => a + b.n, 0);
  if (failedTotal >= LIMITS.failedLogins15m()) {
    found.push({
      key: 'auth.failed.total',
      severity: 'warning',
      message: `${failedTotal} failed login attempts in the last 15 minutes.`,
      meta: { count: failedTotal },
    });
  }
  failed
    .filter((f) => f._id && f.n >= LIMITS.failedLoginsPerSource15m())
    .forEach((f) =>
      found.push({
        key: `auth.failed.ip.${f._id}`,
        severity: 'warning',
        message: `${f.n} failed logins from IP ${f._id} in the last 15 minutes (possible brute force).`,
        meta: { ip: f._id, count: f.n },
      })
    );

  const slow = await ApiMetric.aggregate([
    { $match: { hour: { $gte: new Date(since60.getTime() - 60 * 60 * 1000) } } },
    { $group: { _id: { m: '$method', r: '$route' }, count: { $sum: '$count' }, total: { $sum: '$totalMs' } } },
    { $match: { count: { $gte: 20 } } },
    { $project: { avg: { $divide: ['$total', '$count'] }, count: 1 } },
    { $match: { avg: { $gte: LIMITS.slowAvgMs() } } },
    { $sort: { avg: -1 } },
    { $limit: 5 },
  ]);
  slow.forEach((s) =>
    found.push({
      key: `api.slow.${s._id.m}.${s._id.r}`,
      severity: 'warning',
      message: `Slow endpoint ${s._id.m} ${s._id.r}: average ${Math.round(s.avg)} ms over ${s.count} requests.`,
      meta: { route: s._id.r, method: s._id.m, avgMs: Math.round(s.avg) },
    })
  );

  try {
    const { usedMb, pct } = await dbUsage();
    if (pct >= LIMITS.dbWarnPct()) {
      found.push({
        key: 'db.storage',
        severity: pct >= LIMITS.dbCritPct() ? 'critical' : 'warning',
        message: `Database is using ${usedMb.toFixed(0)} MB (${pct.toFixed(0)}% of ${LIMITS.dbLimitMb()} MB).`,
        meta: { usedMb: Math.round(usedMb), pct: Math.round(pct) },
      });
    }
  } catch (e) {}

  const p = processStats();
  const memPct = ((p.memory.systemTotalMb - p.memory.systemFreeMb) / p.memory.systemTotalMb) * 100;
  if (memPct >= LIMITS.memPct()) {
    found.push({
      key: 'server.memory',
      severity: 'warning',
      message: `Server memory usage is ${memPct.toFixed(0)}%.`,
      meta: { pct: Math.round(memPct) },
    });
  }
  if (p.eventLoopLagMs.p99 >= LIMITS.loopLagMs()) {
    found.push({
      key: 'server.eventloop',
      severity: 'warning',
      message: `Server is responding slowly (event loop delay ${p.eventLoopLagMs.p99} ms).`,
      meta: p.eventLoopLagMs,
    });
  }

  return found;
}

async function recipients() {
  const users = await User.find({ role: { $in: ['admin', 'cto'] }, active: true, subAdmin: { $ne: true } }).select('_id');
  return users.map((u) => u._id);
}

async function runAlerts() {
  const found = await evaluate();
  const activeKeys = new Set(found.map((f) => f.key));

  const open = await SystemLog.find({ level: 'alert', resolvedAt: null });
  for (const a of open) {
    if (!activeKeys.has(a.key)) {
      a.resolvedAt = new Date();
      await a.save();
    }
  }

  const openKeys = new Set(open.filter((a) => activeKeys.has(a.key)).map((a) => a.key));
  const fresh = found.filter((f) => !openKeys.has(f.key));
  if (!fresh.length) return;

  await SystemLog.insertMany(
    fresh.map((f) => ({
      level: 'alert',
      severity: f.severity,
      source: 'alerts',
      message: f.message,
      key: f.key,
      meta: f.meta || {},
    }))
  );

  const ids = await recipients();
  for (const f of fresh) {
    await notifyUsers(ids, {
      type: 'SYSTEM_ALERT',
      title: f.severity === 'critical' ? 'Critical portal alert' : 'Portal alert',
      body: f.message,
      url: '/insights?tab=alerts',
    });
  }
}

function startAlertJob() {
  const run = () => runAlerts().catch(() => {});
  setTimeout(run, 2 * 60 * 1000).unref();
  setInterval(run, num('ALERT_INTERVAL_MINUTES', 5) * 60 * 1000).unref();
}

module.exports = { startAlertJob, runAlerts, dbUsage };
