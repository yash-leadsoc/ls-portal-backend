const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');
const RequestLog = require('../models/RequestLog');
const ApiMetric = require('../models/ApiMetric');
const User = require('../models/User');

const BUCKETS = ApiMetric.BUCKETS;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const LAST_ACTIVE_FLUSH_MS = 5 * 60 * 1000;
const SKIP = new Set(['/api/health', '/api/insights/track']);

const pending = new Map();
const presence = new Map();
const minuteRing = [];
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

let cpuPercent = 0;
let lastCpu = process.cpuUsage();
let lastCpuAt = process.hrtime.bigint();
const startedAt = new Date();
let lag = { mean: 0, p99: 0, max: 0 };

function sampleLoop() {
  const r = (n) => Math.round((n / 1e6) * 10) / 10 || 0;
  lag = { mean: r(loop.mean), p99: r(loop.percentile(99)), max: r(loop.max) };
  loop.reset();
}

function normalizeRoute(req) {
  if (req.route && req.route.path) {
    const p = Array.isArray(req.route.path) ? req.route.path[0] : req.route.path;
    let base = req.baseUrl || '';
    if (!base) base = (req.originalUrl || '').split('?')[0].split('/').slice(0, 3).join('/');
    return `${base}${p === '/' ? '' : p}` || '/';
  }
  const raw = (req.originalUrl || req.url || '').split('?')[0];
  return raw.replace(/[0-9a-f]{24}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n') || '/';
}

function hourStart(d) {
  const h = new Date(d);
  h.setMinutes(0, 0, 0);
  return h;
}

function bucketIndex(ms) {
  return BUCKETS.findIndex((b) => ms <= b);
}

function addMetric(method, route, status, ms, now) {
  const hour = hourStart(now);
  const key = `${hour.toISOString()}|${method}|${route}`;
  let m = pending.get(key);
  if (!m) {
    m = { hour, method, route, count: 0, e4: 0, e5: 0, total: 0, max: 0, buckets: [0, 0, 0, 0, 0, 0, 0, 0] };
    pending.set(key, m);
  }
  m.count += 1;
  if (status >= 500) m.e5 += 1;
  else if (status >= 400) m.e4 += 1;
  m.total += ms;
  if (ms > m.max) m.max = ms;
  m.buckets[bucketIndex(ms)] += 1;

  const minute = Math.floor(now.getTime() / 60000) * 60000;
  let slot = minuteRing[minuteRing.length - 1];
  if (!slot || slot.minute !== minute) {
    slot = { minute, count: 0, errors: 0, totalMs: 0 };
    minuteRing.push(slot);
    while (minuteRing.length > 60) minuteRing.shift();
  }
  slot.count += 1;
  if (status >= 500) slot.errors += 1;
  slot.totalMs += ms;
}

function touchPresence(user, now) {
  if (!user || !user._id) return;
  const id = String(user._id);
  const p = presence.get(id) || { flushedAt: 0 };
  p.id = id;
  p.name = user.name;
  p.role = user.role;
  p.lastSeen = now.getTime();
  presence.set(id, p);
}

function monitor(req, res, next) {
  const url = (req.originalUrl || '').split('?')[0];
  if (!url.startsWith('/api/') || SKIP.has(url) || req.method === 'OPTIONS') return next();

  const start = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);
  res.end = (...args) => {
    if (!res.locals.route) res.locals.route = normalizeRoute(req);
    return originalEnd(...args);
  };
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body.message === 'string') {
      res.locals.errorMessage = body.message.slice(0, 500);
    }
    return originalJson(body);
  };

  res.on('finish', () => {
    try {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const now = new Date();
      const route = res.locals.route || normalizeRoute(req);
      const status = res.statusCode;
      addMetric(req.method, route, status, ms, now);
      touchPresence(req.user, now);

      const isMutation = !['GET', 'HEAD'].includes(req.method);
      if (!isMutation && status < 400) return;

      const u = req.user || {};
      const err = res.locals.error;
      RequestLog.create({
        at: now,
        kind: status >= 400 ? 'error' : 'mutation',
        method: req.method,
        route,
        path: url.slice(0, 300),
        status,
        ms: Math.round(ms),
        user: u._id || null,
        userName: u.name || '',
        role: u.role || '',
        businessUnit: u.role === 'bu' ? u._id : u.businessUnit || null,
        ip: req.ip || '',
        userAgent: (req.get('user-agent') || '').slice(0, 300),
        error: res.locals.errorMessage || (err && err.message ? String(err.message).slice(0, 500) : undefined),
        stack: status >= 500 && err && err.stack ? String(err.stack).slice(0, 2000) : undefined,
      }).catch(() => {});
    } catch (e) {}
  });

  next();
}

async function flushMetrics() {
  if (!pending.size) return;
  const items = [...pending.values()];
  pending.clear();
  const ops = items.map((m) => {
    const inc = { count: m.count, errors4xx: m.e4, errors5xx: m.e5, totalMs: Math.round(m.total) };
    m.buckets.forEach((n, i) => {
      if (n) inc[`b${i}`] = n;
    });
    return {
      updateOne: {
        filter: { hour: m.hour, method: m.method, route: m.route },
        update: {
          $inc: inc,
          $max: { maxMs: Math.round(m.max) },
          $setOnInsert: { hour: m.hour, method: m.method, route: m.route },
        },
        upsert: true,
      },
    };
  });
  try {
    await ApiMetric.bulkWrite(ops, { ordered: false });
  } catch (e) {}
}

async function flushPresence() {
  const now = Date.now();
  const ops = [];
  for (const p of presence.values()) {
    if (p.lastSeen > p.flushedAt && now - p.flushedAt >= LAST_ACTIVE_FLUSH_MS) {
      ops.push({ updateOne: { filter: { _id: p.id }, update: { $set: { lastActiveAt: new Date(p.lastSeen) } } } });
      p.flushedAt = now;
    }
    if (now - p.lastSeen > 24 * 60 * 60 * 1000) presence.delete(p.id);
  }
  if (ops.length) {
    try {
      await User.bulkWrite(ops, { ordered: false });
    } catch (e) {}
  }
}

function sampleCpu() {
  const now = process.hrtime.bigint();
  const usage = process.cpuUsage(lastCpu);
  const elapsedUs = Number(now - lastCpuAt) / 1000;
  cpuPercent = elapsedUs > 0 ? Math.min(100, ((usage.user + usage.system) / elapsedUs / os.cpus().length) * 100) : 0;
  lastCpu = process.cpuUsage();
  lastCpuAt = now;
}

function startMonitorJobs() {
  setInterval(() => flushMetrics(), 60 * 1000).unref();
  setInterval(() => flushPresence(), 60 * 1000).unref();
  setInterval(sampleCpu, 5000).unref();
  setInterval(sampleLoop, 60 * 1000).unref();
}

function onlineUsers() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  return [...presence.values()]
    .filter((p) => p.lastSeen >= cutoff)
    .map((p) => ({ id: p.id, name: p.name, role: p.role, lastSeen: new Date(p.lastSeen) }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

function processStats() {
  const mem = process.memoryUsage();
  return {
    startedAt,
    uptimeSec: Math.round(process.uptime()),
    nodeVersion: process.version,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    cpus: os.cpus().length,
    memory: {
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
      systemTotalMb: Math.round(os.totalmem() / 1048576),
      systemFreeMb: Math.round(os.freemem() / 1048576),
    },
    eventLoopLagMs: lag,
  };
}

function liveMinutes() {
  return minuteRing.map((s) => ({
    minute: new Date(s.minute),
    count: s.count,
    errors: s.errors,
    avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
  }));
}

module.exports = { monitor, startMonitorJobs, flushMetrics, onlineUsers, processStats, liveMinutes };
