const User = require('../models/User');
const Setting = require('../models/Setting');
const MailLog = require('../models/MailLog');
const MockInterview = require('../models/MockInterview');
const ProgressSnapshot = require('../models/ProgressSnapshot');
const { canReceive, systemSender, openSender } = require('./mailer');
const { emailLayout, publicUrl, esc } = require('../utils/emailTemplate');
const { formatDateTime } = require('../utils/time');
const { benchInfo } = require('../utils/bench');
const { logSystem } = require('../utils/systemLog');

const SETTINGS_KEY = 'mail_automation';
const WEEKLY_RUN_KEY = 'mail_automation_weekly_last';
const INACTIVITY_RUN_KEY = 'mail_automation_inactivity_last';
const RUN_WINDOW_MIN = 180;
const DAY_MS = 86400000;

const DEFAULTS = {
  welcome: { enabled: false, includePassword: false },
  domainAssigned: { enabled: false },
  trainerAssigned: { enabled: false },
  mockScheduled: { enabled: false },
  mockResult: { enabled: false },
  inactivity: { enabled: false, days: 7, ccTrainer: false, time: '10:00' },
  weekly: {
    enabled: false,
    day: 1,
    time: '09:00',
    management: true,
    bu: true,
    engineers: true,
    includeDeployed: false,
    extraTo: [],
  },
};

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RX = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------------------------------------------------------------- settings */

function merge(saved) {
  const out = {};
  Object.keys(DEFAULTS).forEach((k) => {
    out[k] = { ...DEFAULTS[k], ...((saved && saved[k]) || {}) };
  });
  return out;
}

async function getSettings() {
  const doc = await Setting.findOne({ key: SETTINGS_KEY }).lean();
  return merge(doc && doc.value);
}

function clean(input = {}) {
  const cur = merge(input);
  const bool = (v) => v === true;
  const time = (v, def) => (TIME_RX.test(String(v || '')) ? String(v) : def);
  return {
    welcome: { enabled: bool(cur.welcome.enabled), includePassword: bool(cur.welcome.includePassword) },
    domainAssigned: { enabled: bool(cur.domainAssigned.enabled) },
    trainerAssigned: { enabled: bool(cur.trainerAssigned.enabled) },
    mockScheduled: { enabled: bool(cur.mockScheduled.enabled) },
    mockResult: { enabled: bool(cur.mockResult.enabled) },
    inactivity: {
      enabled: bool(cur.inactivity.enabled),
      days: Math.min(60, Math.max(3, Math.round(Number(cur.inactivity.days) || 7))),
      ccTrainer: bool(cur.inactivity.ccTrainer),
      time: time(cur.inactivity.time, DEFAULTS.inactivity.time),
    },
    weekly: {
      enabled: bool(cur.weekly.enabled),
      day: Math.min(6, Math.max(0, Math.round(Number(cur.weekly.day)))) || 0,
      time: time(cur.weekly.time, DEFAULTS.weekly.time),
      management: bool(cur.weekly.management),
      bu: bool(cur.weekly.bu),
      engineers: bool(cur.weekly.engineers),
      includeDeployed: bool(cur.weekly.includeDeployed),
      extraTo: [
        ...new Set(
          (Array.isArray(cur.weekly.extraTo) ? cur.weekly.extraTo : String(cur.weekly.extraTo || '').split(/[\s,;]+/))
            .map((e) => String(e || '').trim().toLowerCase())
            .filter((e) => EMAIL_RX.test(e))
        ),
      ].slice(0, 50),
    },
  };
}

async function saveSettings(input, userId) {
  const value = clean(input);
  if (Number.isNaN(Number(input?.weekly?.day))) value.weekly.day = DEFAULTS.weekly.day;
  await Setting.findOneAndUpdate({ key: SETTINGS_KEY }, { $set: { value, updatedBy: userId || null } }, { upsert: true });
  return value;
}

/* ------------------------------------------------------------------- time */

function istParts(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return { day: ist.getUTCDay(), hhmm: ist.toISOString().slice(11, 16), date: ist.toISOString().slice(0, 10) };
}

function istDate(d) {
  return d ? istParts(new Date(d)).date : null;
}

function weekKey(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  ist.setUTCDate(ist.getUTCDate() - ((ist.getUTCDay() + 6) % 7));
  return ist.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

function minutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function prettyDate(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* ------------------------------------------------------------- mail queue */

const queue = [];
let draining = null;

function delayMs() {
  return Number(process.env.MAIL_DELAY_MS || 400);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addrList(v) {
  return (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
}

async function log(item, status, error = '') {
  try {
    await MailLog.create({
      kind: item.kind,
      to: addrList(item.to).join(', ').slice(0, 2000),
      cc: addrList(item.cc).join(', ').slice(0, 1000),
      user: item.userId || null,
      subject: String(item.subject || '').slice(0, 300),
      status,
      error: String(error || '').slice(0, 300),
    });
  } catch (e) {
    /* logging must never break sending */
  }
}

function toText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|\/p|\/tr|\/h\d|\/div)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function message(item) {
  return {
    fromName: 'LeadSoC TEDP',
    to: item.to,
    toName: Array.isArray(item.to) ? undefined : item.toName,
    cc: addrList(item.cc),
    replyTo: item.replyTo || undefined,
    subject: item.subject,
    html: item.html,
    text: toText(item.html),
  };
}

async function drain() {
  while (queue.length) {
    const sender = await systemSender();
    if (sender.error) {
      const pending = queue.splice(0, queue.length);
      for (const it of pending) await log(it, 'skipped', sender.error);
      return;
    }
    const mailer = openSender(sender);
    try {
      let n = 0;
      while (queue.length && n < 100) {
        const it = queue.shift();
        n += 1;
        try {
          await mailer.send(message(it));
          await log(it, 'sent');
        } catch (e) {
          await log(it, 'failed', e && e.message);
        }
        if (queue.length) await sleep(delayMs());
      }
    } finally {
      mailer.close();
    }
  }
}

function enqueue(item) {
  if (!addrList(item.to).length) return;
  queue.push(item);
  if (!draining) {
    draining = drain()
      .catch((e) => logSystem('error', 'mail', `Automation mail queue failed: ${e.message}`))
      .finally(() => {
        draining = null;
      });
  }
}

async function idle() {
  while (draining) await draining;
}

async function sendDirect(item) {
  const sender = await systemSender();
  if (sender.error) throw Object.assign(new Error(sender.error), { status: 400 });
  const mailer = openSender(sender);
  try {
    await mailer.send(message(item));
    await log(item, 'sent');
  } catch (e) {
    await log(item, 'failed', e && e.message);
    throw Object.assign(new Error(`Could not send: ${e.message}`), { status: 502 });
  } finally {
    mailer.close();
  }
}

/* ------------------------------------------------------------ html pieces */

const FONT = 'font-family:Arial,Helvetica,sans-serif;';

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px"><tr><td style="background:#1b2b5e;border-radius:8px"><a href="${esc(href)}" style="display:inline-block;padding:11px 22px;${FONT}font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none">${esc(label)}</a></td></tr></table>`;
}

function details(rows) {
  const tr = rows
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 12px;${FONT}font-size:13px;color:#64748b;width:140px;vertical-align:top;border-bottom:1px solid #eef1f6">${esc(k)}</td><td style="padding:7px 12px;${FONT}font-size:13px;color:#16213f;font-weight:bold;border-bottom:1px solid #eef1f6">${v}</td></tr>`
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:14px 0;border:1px solid #e5e9f2;border-radius:8px;border-collapse:separate">${tr}</table>`;
}

function heading(text) {
  return `<div style="${FONT}font-size:19px;font-weight:bold;color:#1b2b5e;margin:0 0 12px">${esc(text)}</div>`;
}

function muted(text) {
  return `<div style="${FONT}font-size:12px;color:#64748b;margin-top:10px">${text}</div>`;
}

const FOOTER = 'This is an automated message from LeadSoC TEDP.';

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function pctColor(p) {
  if (p >= 70) return '#15803d';
  if (p >= 40) return '#b45309';
  return '#b91c1c';
}

function pctCell(p) {
  return `<span style="${FONT}font-size:13px;font-weight:bold;color:${pctColor(p)}">${p}%</span>`;
}

function deltaCell(d) {
  if (d == null) return `<span style="color:#94a3b8">—</span>`;
  if (d > 0) return `<span style="color:#15803d;font-weight:bold">+${d}%</span>`;
  if (d < 0) return `<span style="color:#b91c1c;font-weight:bold">${d}%</span>`;
  return `<span style="color:#94a3b8">0%</span>`;
}

function roleLabel(u) {
  if (u.role === 'employee') return 'Engineer';
  if (u.role === 'manager') return 'Trainer';
  if (u.role === 'bu') return u.headOnly ? 'BU Head' : 'Business Unit';
  if (u.role === 'cto') return u.designation || 'Management';
  if (u.role === 'admin') return u.subAdmin ? 'Sub admin' : 'Admin';
  return u.role;
}

const site = (path = '/') => `${publicUrl()}${path}`;

/* -------------------------------------------------------- event emails */

function fire(label, fn) {
  setImmediate(() => {
    Promise.resolve()
      .then(fn)
      .catch((e) => logSystem('warn', 'mail', `${label} email failed: ${e.message}`));
  });
}

function canMail(u) {
  return !!u && u.active !== false && !u.loginDisabled && canReceive(u.email);
}

async function welcomeMail(userId, { password } = {}) {
  const s = await getSettings();
  if (!s.welcome.enabled) return;
  const u = await User.findById(userId).populate('businessUnit', 'name').populate('manager', 'name email').lean();
  if (!canMail(u)) return;
  const showPw = s.welcome.includePassword && password;
  const body = [
    heading('Welcome to LeadSoC TEDP'),
    `Dear ${esc(u.name)},<br><br>An account has been created for you on the LeadSoC Talent Enablement &amp; Deployment Platform.`,
    details([
      ['Role', esc(roleLabel(u))],
      ['Login', esc(u.email)],
      ['Employee ID', esc(u.employeeCode || '')],
      ['Password', showPw ? `<span style="font-family:Consolas,Menlo,monospace">${esc(password)}</span>` : null],
      ['Business unit', u.businessUnit && u.businessUnit.name ? esc(u.businessUnit.name) : null],
      ['Trainer', u.manager && u.manager.name ? esc(u.manager.name) : null],
    ]),
    showPw
      ? 'Please change this password after your first login (Settings → Change password).'
      : 'To set your password, open the portal and click <b>Forgot password?</b> on the sign-in page. We will email you a code.',
    button(site('/'), 'Open the portal'),
  ].join('');
  enqueue({
    kind: 'welcome',
    userId: u._id,
    to: u.email,
    toName: u.name,
    subject: 'Welcome to LeadSoC TEDP',
    html: emailLayout({ bodyHtml: body, footerHtml: FOOTER, preheader: 'Your LeadSoC TEDP account is ready' }),
  });
}

async function domainsAssignedMail(userId, addedIds, actor) {
  const s = await getSettings();
  if (!s.domainAssigned.enabled || !addedIds || !addedIds.length) return;
  const Domain = require('../models/Domain');
  const [u, domains] = await Promise.all([
    User.findById(userId).populate('manager', 'name email').lean(),
    Domain.find({ _id: { $in: addedIds } }).select('name icon').sort({ name: 1 }).lean(),
  ]);
  if (!canMail(u) || !domains.length) return;
  const list = domains
    .map((d) => `<li style="margin:4px 0">${esc(d.icon || '📘')} <b>${esc(d.name)}</b></li>`)
    .join('');
  const body = [
    heading(domains.length === 1 ? 'New learning domain assigned' : 'New learning domains assigned'),
    `Dear ${esc(u.name)},<br><br>The following ${domains.length === 1 ? 'domain has' : 'domains have'} been added to your training plan:`,
    `<ul style="${FONT}font-size:14px;padding-left:20px;margin:12px 0">${list}</ul>`,
    u.manager && u.manager.name ? `Your trainer is <b>${esc(u.manager.name)}</b>.` : '',
    button(site('/'), 'Start learning'),
  ].join('');
  enqueue({
    kind: 'domain_assigned',
    userId: u._id,
    to: u.email,
    toName: u.name,
    replyTo: actor && canReceive(actor.email) ? actor.email : undefined,
    subject: `New learning domain${domains.length === 1 ? '' : 's'}: ${domains.map((d) => d.name).join(', ')}`.slice(0, 200),
    html: emailLayout({ bodyHtml: body, footerHtml: FOOTER, preheader: 'Your training plan has been updated' }),
  });
}

async function trainerAssignedMail(userId, trainerId, { notifyEngineer = true } = {}) {
  const s = await getSettings();
  if (!s.trainerAssigned.enabled || !trainerId) return;
  const [eng, trainer] = await Promise.all([
    User.findById(userId).populate('businessUnit', 'name').lean(),
    User.findById(trainerId).lean(),
  ]);
  if (!eng || !trainer) return;
  if (notifyEngineer && canMail(eng)) {
    const body = [
      heading('Your trainer has been assigned'),
      `Dear ${esc(eng.name)},<br><br><b>${esc(trainer.name)}</b> is now your trainer on LeadSoC TEDP. Reach out to them with any questions about your training.`,
      details([
        ['Trainer', esc(trainer.name)],
        ['Email', canReceive(trainer.email) ? `<a href="mailto:${esc(trainer.email)}" style="color:#0284a8">${esc(trainer.email)}</a>` : null],
      ]),
      button(site('/'), 'Open the portal'),
    ].join('');
    enqueue({
      kind: 'trainer_assigned',
      userId: eng._id,
      to: eng.email,
      toName: eng.name,
      replyTo: canReceive(trainer.email) ? trainer.email : undefined,
      subject: `Your trainer: ${trainer.name}`,
      html: emailLayout({ bodyHtml: body, footerHtml: FOOTER }),
    });
  }
  if (canMail(trainer)) {
    const body = [
      heading('New engineer assigned to you'),
      `Dear ${esc(trainer.name)},<br><br><b>${esc(eng.name)}</b> has been assigned to you for training.`,
      details([
        ['Engineer', esc(eng.name)],
        ['LSID', esc(eng.employeeCode || '')],
        ['Business unit', eng.businessUnit && eng.businessUnit.name ? esc(eng.businessUnit.name) : null],
        ['Email', canReceive(eng.email) ? `<a href="mailto:${esc(eng.email)}" style="color:#0284a8">${esc(eng.email)}</a>` : null],
      ]),
      button(site(`/employee/${eng._id}`), 'View engineer'),
    ].join('');
    enqueue({
      kind: 'trainer_assigned',
      userId: trainer._id,
      to: trainer.email,
      toName: trainer.name,
      replyTo: canReceive(eng.email) ? eng.email : undefined,
      subject: `New engineer assigned: ${eng.name}`,
      html: emailLayout({ bodyHtml: body, footerHtml: FOOTER }),
    });
  }
}

async function mockScheduledMail(mockId) {
  const s = await getSettings();
  if (!s.mockScheduled.enabled) return;
  const m = await MockInterview.findById(mockId).populate('employee').populate('scheduledBy', 'name email').lean();
  if (!m || !canMail(m.employee)) return;
  const by = m.scheduledBy;
  const body = [
    heading('Mock interview scheduled'),
    `Dear ${esc(m.employee.name)},<br><br>A mock interview has been scheduled for you.`,
    details([
      ['When', esc(`${formatDateTime(m.scheduledAt)} IST`)],
      ['Duration', `${esc(m.durationMins || 45)} minutes`],
      ['For role', m.forRole ? esc(m.forRole) : null],
      ['Interviewer', by && by.name ? esc(by.name) : null],
      ['Meeting link', m.meetLink ? `<a href="${esc(m.meetLink)}" style="color:#0284a8">${esc(m.meetLink)}</a>` : null],
    ]),
    'Please join on time and keep your resume and recent work handy.',
    m.meetLink ? button(m.meetLink, 'Join meeting') : button(site('/interviews'), 'View in portal'),
  ].join('');
  enqueue({
    kind: 'mock_scheduled',
    userId: m.employee._id,
    to: m.employee.email,
    toName: m.employee.name,
    cc: by && canReceive(by.email) ? [by.email] : [],
    replyTo: by && canReceive(by.email) ? by.email : undefined,
    subject: `Mock interview on ${formatDateTime(m.scheduledAt)}`,
    html: emailLayout({ bodyHtml: body, footerHtml: FOOTER, preheader: `Scheduled for ${formatDateTime(m.scheduledAt)} IST` }),
  });
}

async function mockResultMail(mockId, actor) {
  const s = await getSettings();
  if (!s.mockResult.enabled) return;
  const m = await MockInterview.findById(mockId).populate('employee').lean();
  if (!m || !canMail(m.employee)) return;
  const cancelled = m.status === 'cancelled';
  const review = m.review ? esc(m.review).replace(/\n/g, '<br>') : '';
  const body = cancelled
    ? [
        heading('Mock interview cancelled'),
        `Dear ${esc(m.employee.name)},<br><br>Your mock interview scheduled for <b>${esc(formatDateTime(m.scheduledAt))} IST</b> has been cancelled.`,
        review ? `<div style="margin-top:12px"><b>Note:</b><br>${review}</div>` : '',
        button(site('/interviews'), 'View in portal'),
      ].join('')
    : [
        heading('Your mock interview result'),
        `Dear ${esc(m.employee.name)},<br><br>Your mock interview${m.forRole ? ` for <b>${esc(m.forRole)}</b>` : ''} has been reviewed.`,
        details([
          ['Score', m.score != null ? `<span style="font-size:18px;color:${pctColor(m.score * 10)}">${esc(m.score)}/10</span>` : null],
          ['Date', esc(formatDateTime(m.scheduledAt))],
          ['Reviewed by', actor && actor.name ? esc(actor.name) : null],
        ]),
        review ? `<div style="${FONT}font-size:14px;margin-top:6px"><b>Feedback</b><div style="margin-top:6px;padding:12px 14px;background:#f4f6fb;border-radius:8px">${review}</div></div>` : '',
        button(site('/interviews'), 'View details'),
      ].join('');
  enqueue({
    kind: 'mock_result',
    userId: m.employee._id,
    to: m.employee.email,
    toName: m.employee.name,
    replyTo: actor && canReceive(actor.email) ? actor.email : undefined,
    subject: cancelled ? 'Mock interview cancelled' : `Mock interview result${m.score != null ? `: ${m.score}/10` : ''}`,
    html: emailLayout({ bodyHtml: body, footerHtml: FOOTER }),
  });
}

/* ---------------------------------------------------------- weekly data */

async function enrolledEngineers({ includeDeployed }) {
  const filter = { role: 'employee', active: true, 'assignedDomains.0': { $exists: true } };
  if (!includeDeployed) filter.jobStatus = { $ne: 'deployed' };
  return User.find(filter)
    .select(
      'name email employeeCode businessUnit manager assignedDomains domainAssignedAt enrolledAt createdAt benchStart jobStatus deployedAt streak loginDisabled active'
    )
    .populate('businessUnit', 'name')
    .populate('manager', 'name email active loginDisabled')
    .sort({ name: 1 })
    .lean();
}

function idleDaysOf(e, today) {
  const ref = (e.streak && e.streak.lastActiveDate) || null;
  return ref ? daysBetween(ref, today) : null;
}

function summarize(engineers) {
  const map = new Map();
  engineers.forEach((e) =>
    e.rows.forEach((r) => {
      if (!map.has(r.domainId)) map.set(r.domainId, { id: r.domainId, name: r.domainName, icon: r.domainIcon, rows: [] });
      map.get(r.domainId).rows.push({ ...r, engineer: e });
    })
  );
  const domains = [...map.values()]
    .map((d) => {
      d.rows.sort((a, b) => b.pct - a.pct || a.engineer.name.localeCompare(b.engineer.name));
      d.avg = d.rows.length ? Math.round(d.rows.reduce((a, r) => a + r.pct, 0) / d.rows.length) : 0;
      return d;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const all = engineers.flatMap((e) => e.rows);
  return {
    engineers,
    domains,
    kpis: {
      engineers: engineers.length,
      avg: all.length ? Math.round(all.reduce((a, r) => a + r.pct, 0) / all.length) : 0,
      improved: engineers.filter((e) => e.rows.some((r) => r.delta > 0)).length,
      stalled: engineers.filter((e) => e.stalled).length,
      zero: engineers.filter((e) => e.rows.every((r) => r.pct === 0)).length,
    },
  };
}

async function buildWeeklyData(settings) {
  const { computeEmployeeProgress, loadProgressContent } = require('../controllers/trackingController');
  const emps = await enrolledEngineers({ includeDeployed: settings.weekly.includeDeployed });
  const content = await loadProgressContent();
  const domainById = new Map(content.domains.map((d) => [String(d._id), d]));
  const wk = weekKey();
  const prevSnap = await ProgressSnapshot.findOne({ weekKey: { $lt: wk } }).sort({ weekKey: -1 }).lean();
  const prev = new Map((prevSnap ? prevSnap.rows : []).map((r) => [`${r.employee}:${r.domain}`, r.pct]));
  const today = istParts().date;
  const engineers = [];

  for (const e of emps) {
    const progress = await computeEmployeeProgress(e._id, content);
    const byDomain = {};
    Object.values(progress).forEach((p) => (byDomain[p.domainId] = p));
    const assignedAt = new Map((e.domainAssignedAt || []).map((a) => [String(a.domain), a.at]));
    const rows = [];
    [...new Set((e.assignedDomains || []).map(String))].forEach((did) => {
      const d = domainById.get(did);
      if (!d) return;
      const p = byDomain[did];
      const pct = p && p.overall != null ? p.overall : 0;
      const since = assignedAt.get(did) || e.enrolledAt || e.createdAt;
      const key = `${e._id}:${did}`;
      rows.push({
        domainId: did,
        domainName: d.name,
        domainIcon: d.icon || '📘',
        pct,
        days: since ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / DAY_MS)) : null,
        delta: prev.has(key) ? pct - prev.get(key) : null,
      });
    });
    if (!rows.length) continue;
    const idle = idleDaysOf(e, today);
    const enrolledDays = daysBetween(istDate(e.enrolledAt || e.createdAt) || today, today);
    engineers.push({
      id: String(e._id),
      name: e.name,
      email: e.email,
      canMail: canMail(e),
      code: e.employeeCode || '',
      buId: e.businessUnit ? String(e.businessUnit._id) : '',
      buName: (e.businessUnit && e.businessUnit.name) || '—',
      trainer: e.manager || null,
      benchDays: benchInfo(e).benchDays,
      idleDays: idle,
      stalled: idle == null ? enrolledDays >= 7 : idle >= 7,
      rows: rows.sort((a, b) => a.domainName.localeCompare(b.domainName)),
    });
  }
  return { weekKey: wk, hasPrev: !!prevSnap, ...summarize(engineers) };
}

/* ------------------------------------------------------- weekly html */

const TH = `padding:8px 10px;${FONT}font-size:11px;font-weight:bold;color:#475569;text-transform:uppercase;letter-spacing:.04em;text-align:left;background:#f4f6fb;border-bottom:1px solid #e5e9f2`;
const TD = `padding:8px 10px;${FONT}font-size:13px;color:#16213f;border-bottom:1px solid #eef1f6;vertical-align:top`;

function kpiTiles(k, hasPrev) {
  const tile = (value, label, color = '#1b2b5e') =>
    `<td width="25%" style="padding:4px"><div style="background:#f4f6fb;border-radius:10px;padding:12px 10px;text-align:center"><div style="${FONT}font-size:22px;font-weight:bold;color:${color}">${value}</div><div style="${FONT}font-size:11.5px;color:#64748b;margin-top:2px">${label}</div></div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px"><tr>${[
    tile(k.engineers, 'Engineers enrolled'),
    tile(`${k.avg}%`, 'Average completion', pctColor(k.avg)),
    tile(hasPrev ? k.improved : '—', 'Improved this week', '#15803d'),
    tile(k.stalled, 'No activity 7+ days', k.stalled ? '#b91c1c' : '#1b2b5e'),
  ].join('')}</tr></table>`;
}

function idleNote(e) {
  if (!e.stalled) return '';
  const text = e.idleDays == null ? 'No activity yet' : `No activity ${e.idleDays}d`;
  return `<div style="${FONT}font-size:11px;color:#b91c1c;margin-top:2px">● ${text}</div>`;
}

function domainTable(d, { showBU }) {
  const head = `<tr><th style="${TH}">Engineer</th>${showBU ? `<th style="${TH}">BU</th>` : ''}<th style="${TH}">Completion</th><th style="${TH}">This week</th><th style="${TH}">Days in domain</th><th style="${TH}">Bench ageing</th></tr>`;
  const body = d.rows
    .map(
      (r) =>
        `<tr><td style="${TD}"><b>${esc(r.engineer.name)}</b><div style="font-size:11px;color:#64748b">${esc(r.engineer.code)}</div>${idleNote(r.engineer)}</td>${
          showBU ? `<td style="${TD}">${esc(r.engineer.buName)}</td>` : ''
        }<td style="${TD}">${pctCell(r.pct)}</td><td style="${TD}">${deltaCell(r.delta)}</td><td style="${TD}">${r.days != null ? r.days : '—'}</td><td style="${TD}">${
          r.engineer.benchDays != null ? `${r.engineer.benchDays}d` : '—'
        }</td></tr>`
    )
    .join('');
  return `<div style="${FONT}font-size:15px;font-weight:bold;color:#1b2b5e;margin:22px 0 8px">${esc(d.icon)} ${esc(d.name)} <span style="font-size:12px;font-weight:normal;color:#64748b">· ${d.rows.length} engineer${d.rows.length === 1 ? '' : 's'} · average ${d.avg}%</span></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e9f2;border-collapse:collapse">${head}${body}</table>`;
}

function reportMail(view, { greeting, scopeText, weekKeyStr, hasPrev, showBU = true }) {
  const body = [
    heading(`Weekly training progress · week of ${prettyDate(weekKeyStr)}`),
    `${greeting}<br><br>Here is the training progress of ${scopeText}, by domain.`,
    kpiTiles(view.kpis, hasPrev),
    view.domains.length
      ? view.domains.map((d) => domainTable(d, { showBU })).join('')
      : '<div style="padding:16px;background:#f4f6fb;border-radius:8px">No engineers are enrolled in any domain yet.</div>',
    muted(
      `<b>Completion</b> is the average of materials reviewed, checklists, write-ups and exercises in the domain. <b>This week</b> is the change since the last weekly report${
        hasPrev ? '' : ' (shown from next week)'
      }. <b>Days in domain</b> counts from when the domain was assigned.`
    ),
    button(site('/training-overview'), 'Open Training Overview'),
  ].join('');
  return emailLayout({
    bodyHtml: body,
    footerHtml: FOOTER,
    width: 820,
    preheader: `${view.kpis.engineers} engineers · average completion ${view.kpis.avg}% · ${view.kpis.stalled} with no activity in 7+ days`,
  });
}

function engineerMail(e, { weekKeyStr, hasPrev }) {
  const rows = e.rows
    .map(
      (r) =>
        `<tr><td style="${TD}">${esc(r.domainIcon)} <b>${esc(r.domainName)}</b></td><td style="${TD}">${pctCell(r.pct)}</td><td style="${TD}">${deltaCell(
          r.delta
        )}</td><td style="${TD}">${r.days != null ? r.days : '—'}</td></tr>`
    )
    .join('');
  const avg = Math.round(e.rows.reduce((a, r) => a + r.pct, 0) / e.rows.length);
  const nudge = e.stalled
    ? `<div style="margin:14px 0;padding:12px 14px;background:#fdecec;border-radius:8px;color:#a32d2d">${
        e.idleDays == null
          ? 'You have not started your training yet.'
          : `We have not seen any learning activity from you in the last ${e.idleDays} days.`
      } A little progress every day adds up. Pick up where you left off today.</div>`
    : '';
  const body = [
    heading(`Your weekly progress · week of ${prettyDate(weekKeyStr)}`),
    `Hi ${esc(firstName(e.name))},<br><br>Here is where you stand in your training this week. Your overall completion is <b style="color:${pctColor(avg)}">${avg}%</b>.`,
    nudge,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border:1px solid #e5e9f2;border-collapse:collapse"><tr><th style="${TH}">Domain</th><th style="${TH}">Completion</th><th style="${TH}">This week</th><th style="${TH}">Days in domain</th></tr>${rows}</table>`,
    e.benchDays != null ? muted(`Bench ageing: <b>${e.benchDays} days</b>.${hasPrev ? '' : ' Weekly change is shown from next week.'}`) : '',
    button(site('/'), 'Continue learning'),
  ].join('');
  return emailLayout({ bodyHtml: body, footerHtml: FOOTER, preheader: `Your overall training completion is ${avg}%` });
}

/* -------------------------------------------------- weekly recipients */

async function managementRecipients(settings) {
  const mgmt = await User.find({ role: 'cto', active: true, loginDisabled: { $ne: true } }).select('name email').lean();
  return [...new Set([...mgmt.map((u) => u.email).filter(canReceive).map((e) => e.toLowerCase()), ...settings.weekly.extraTo])];
}

async function buRecipients() {
  const Category = require('../models/Category');
  const [people, units, cats] = await Promise.all([
    User.find({ role: 'bu', active: true, loginDisabled: { $ne: true } }).select('name email headOnly unitAccess category').lean(),
    User.find({ role: 'bu', headOnly: { $ne: true } }).select('name category').lean(),
    Category.find({}).select('parent').lean(),
  ]);
  const parentOf = new Map(cats.map((c) => [String(c._id), c.parent ? String(c.parent) : null]));
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const subUnits = (unit) => {
    const cat = unit && unit.category ? String(unit.category) : null;
    if (!cat || parentOf.get(cat)) return [];
    return units.filter((u) => u.category && parentOf.get(String(u.category)) === cat).map((u) => String(u._id));
  };
  return people
    .filter((p) => canReceive(p.email))
    .map((p) => {
      const own = p.headOnly ? [] : [String(p._id)];
      const base = [...own, ...(p.unitAccess || []).map((a) => String(a.unit))];
      const ids = new Set(base);
      base.forEach((id) => subUnits(unitById.get(id)).forEach((s) => ids.add(s)));
      const names = base.map((id) => unitById.get(id)?.name).filter(Boolean);
      return { person: p, unitIds: ids, unitNames: names };
    })
    .filter((r) => r.unitIds.size);
}

/* ------------------------------------------------------- weekly run */

async function saveSnapshot(data) {
  const rows = data.engineers.flatMap((e) => e.rows.map((r) => ({ employee: e.id, domain: r.domainId, pct: r.pct })));
  await ProgressSnapshot.findOneAndUpdate({ weekKey: data.weekKey }, { $set: { rows } }, { upsert: true });
  const keep = await ProgressSnapshot.find({}).sort({ weekKey: -1 }).skip(16).select('_id').lean();
  if (keep.length) await ProgressSnapshot.deleteMany({ _id: { $in: keep.map((k) => k._id) } });
}

async function runWeekly({ settings, trigger = 'schedule' } = {}) {
  const s = settings || (await getSettings());
  const data = await buildWeeklyData(s);
  const counts = { management: 0, bu: 0, engineers: 0 };
  const opts = { weekKeyStr: data.weekKey, hasPrev: data.hasPrev };
  const subjectSuffix = `week of ${prettyDate(data.weekKey)}`;

  if (s.weekly.management) {
    const to = await managementRecipients(s);
    if (to.length) {
      enqueue({
        kind: 'weekly_management',
        to,
        subject: `Weekly training progress · ${subjectSuffix}`,
        html: reportMail(data, { ...opts, greeting: 'Dear Leadership team,', scopeText: 'all enrolled engineers' }),
      });
      counts.management = to.length;
    }
  }

  if (s.weekly.bu) {
    const list = await buRecipients();
    list.forEach(({ person, unitIds, unitNames }) => {
      const mine = summarize(data.engineers.filter((e) => unitIds.has(e.buId)));
      if (!mine.engineers.length) return;
      enqueue({
        kind: 'weekly_bu',
        userId: person._id,
        to: person.email,
        toName: person.name,
        subject: `Weekly training progress · ${unitNames.join(', ') || person.name} · ${subjectSuffix}`.slice(0, 200),
        html: reportMail(mine, {
          ...opts,
          greeting: `Dear ${esc(person.name)},`,
          scopeText: `engineers in <b>${esc(unitNames.join(', ') || 'your unit')}</b>`,
          showBU: unitIds.size > 1,
        }),
      });
      counts.bu += 1;
    });
  }

  if (s.weekly.engineers) {
    data.engineers
      .filter((e) => e.canMail)
      .forEach((e) => {
        enqueue({
          kind: 'weekly_engineer',
          userId: e.id,
          to: e.email,
          toName: e.name,
          subject: `Your weekly training progress · ${subjectSuffix}`,
          html: engineerMail(e, opts),
        });
        counts.engineers += 1;
      });
  }

  await saveSnapshot(data);
  await Setting.findOneAndUpdate(
    { key: WEEKLY_RUN_KEY },
    { $set: { value: data.weekKey } },
    { upsert: true }
  );
  await logSystem('info', 'mail', `Weekly progress report queued (${trigger})`, counts);
  return { weekKey: data.weekKey, ...counts };
}

async function weeklyPreview(kind) {
  const s = await getSettings();
  const data = await buildWeeklyData(s);
  const opts = { weekKeyStr: data.weekKey, hasPrev: data.hasPrev };
  if (kind === 'engineer') {
    const e = data.engineers[0];
    if (!e) return { subject: '', html: '', empty: 'No engineers are enrolled in a domain yet.' };
    return { subject: 'Your weekly training progress', html: engineerMail(e, opts), sampleOf: e.name };
  }
  if (kind === 'bu') {
    const list = await buRecipients();
    for (const r of list) {
      const mine = summarize(data.engineers.filter((e) => r.unitIds.has(e.buId)));
      if (!mine.engineers.length) continue;
      return {
        subject: `Weekly training progress · ${r.unitNames.join(', ')}`,
        html: reportMail(mine, {
          ...opts,
          greeting: `Dear ${esc(r.person.name)},`,
          scopeText: `engineers in <b>${esc(r.unitNames.join(', ') || 'your unit')}</b>`,
          showBU: r.unitIds.size > 1,
        }),
        sampleOf: r.person.name,
      };
    }
    return { subject: '', html: '', empty: 'No BU head has enrolled engineers yet.' };
  }
  return {
    subject: 'Weekly training progress',
    html: reportMail(data, { ...opts, greeting: 'Dear Leadership team,', scopeText: 'all enrolled engineers' }),
  };
}

async function weeklyTest(me) {
  if (!canReceive(me.email)) throw Object.assign(new Error('Your account has no valid email address'), { status: 400 });
  const p = await weeklyPreview('management');
  await sendDirect({ kind: 'weekly_test', userId: me._id, to: me.email, toName: me.name, subject: `[Test] ${p.subject}`, html: p.html });
}

/* -------------------------------------------------------- inactivity */

async function runInactivity({ settings } = {}) {
  const s = settings || (await getSettings());
  const days = s.inactivity.days;
  const today = istParts().date;
  const emps = await enrolledEngineers({ includeDeployed: false });
  const { computeEmployeeProgress, loadProgressContent } = require('../controllers/trackingController');
  let content = null;
  let sent = 0;
  for (const e of emps) {
    if (!canMail(e)) continue;
    const ref = (e.streak && e.streak.lastActiveDate) || istDate(e.enrolledAt || e.createdAt);
    const idle = ref ? daysBetween(ref, today) : 0;
    if (idle < days) continue;
    const recent = await MailLog.exists({
      kind: 'inactivity',
      user: e._id,
      status: 'sent',
      createdAt: { $gte: new Date(Date.now() - days * DAY_MS) },
    });
    if (recent) continue;
    content = content || (await loadProgressContent());
    const progress = await computeEmployeeProgress(e._id, content);
    const assigned = new Set((e.assignedDomains || []).map(String));
    const rows = Object.values(progress)
      .filter((p) => assigned.has(p.domainId))
      .map(
        (p) =>
          `<tr><td style="${TD}">${esc(p.icon || '📘')} <b>${esc(p.name)}</b></td><td style="${TD}">${pctCell(p.overall || 0)}</td></tr>`
      )
      .join('');
    const neverStarted = !(e.streak && e.streak.lastActiveDate);
    const body = [
      heading(neverStarted ? "Let's get your training started" : 'We miss you on TEDP'),
      `Hi ${esc(firstName(e.name))},<br><br>${
        neverStarted
          ? `You were enrolled ${idle} days ago but have not started your training yet.`
          : `We have not seen any learning activity from you in the last <b>${idle} days</b>.`
      } Even 20 minutes a day keeps you moving toward deployment.`,
      rows
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border:1px solid #e5e9f2;border-collapse:collapse"><tr><th style="${TH}">Domain</th><th style="${TH}">Your completion</th></tr>${rows}</table>`
        : '',
      button(site('/'), 'Continue learning'),
    ].join('');
    const trainer = e.manager;
    enqueue({
      kind: 'inactivity',
      userId: e._id,
      to: e.email,
      toName: e.name,
      cc: s.inactivity.ccTrainer && canMail(trainer) ? [trainer.email] : [],
      replyTo: canMail(trainer) ? trainer.email : undefined,
      subject: neverStarted ? 'Your training is waiting for you' : `No learning activity in ${idle} days`,
      html: emailLayout({ bodyHtml: body, footerHtml: FOOTER }),
    });
    sent += 1;
  }
  if (sent) await logSystem('info', 'mail', `Inactivity reminders queued: ${sent}`);
  return { queued: sent };
}

/* --------------------------------------------------------- scheduler */

async function claim(key, value) {
  const updated = await Setting.findOneAndUpdate({ key, value: { $ne: value } }, { $set: { value } }, { new: true }).lean();
  if (updated) return true;
  if (await Setting.exists({ key })) return false;
  try {
    await Setting.create({ key, value });
    return true;
  } catch (e) {
    return false;
  }
}

function inWindow(nowHHMM, startHHMM) {
  const diff = minutes(nowHHMM) - minutes(startHHMM);
  return diff >= 0 && diff < RUN_WINDOW_MIN;
}

async function tick() {
  const s = await getSettings();
  const now = istParts();
  if (s.weekly.enabled && now.day === Number(s.weekly.day) && inWindow(now.hhmm, s.weekly.time)) {
    if (await claim(WEEKLY_RUN_KEY, weekKey())) await runWeekly({ settings: s, trigger: 'schedule' });
  }
  if (s.inactivity.enabled && inWindow(now.hhmm, s.inactivity.time)) {
    if (await claim(INACTIVITY_RUN_KEY, now.date)) await runInactivity({ settings: s });
  }
}

function startAutomationJob() {
  const run = () => tick().catch((e) => logSystem('error', 'mail', `Email automation job failed: ${e.message}`));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 5 * 60 * 1000).unref();
}

/* ------------------------------------------------------------ status */

async function status() {
  const [settings, sender, mgmt, bus, engineers, last] = await Promise.all([
    getSettings(),
    systemSender(),
    User.find({ role: 'cto', active: true, loginDisabled: { $ne: true } }).select('email').lean(),
    buRecipients(),
    User.countDocuments({ role: 'employee', active: true, 'assignedDomains.0': { $exists: true }, jobStatus: { $ne: 'deployed' } }),
    Setting.findOne({ key: WEEKLY_RUN_KEY }).lean(),
  ]);
  return {
    settings,
    mailbox: sender.error ? { ok: false, error: sender.error } : { ok: true, from: sender.from },
    audience: {
      management: mgmt.filter((u) => canReceive(u.email)).length,
      buHeads: bus.length,
      engineers,
    },
    lastWeeklyRun: last && last.value ? last.value : null,
  };
}

/* ----------------------------------------------------------- hooks */

module.exports = {
  getSettings,
  saveSettings,
  status,
  runWeekly,
  runInactivity,
  weeklyPreview,
  weeklyTest,
  startAutomationJob,
  idle,
  _test: { tick, weekKey, istParts, buildWeeklyData },
  onUserCreated: (user, opts) => fire('Welcome', () => welcomeMail(user._id || user, opts)),
  onDomainsAssigned: (user, added, actor) => fire('Domain assigned', () => domainsAssignedMail(user._id || user, added, actor)),
  onTrainerAssigned: (user, trainerId, opts) => fire('Trainer assigned', () => trainerAssignedMail(user._id || user, trainerId, opts)),
  onMockScheduled: (mock) => fire('Mock scheduled', () => mockScheduledMail(mock._id || mock)),
  onMockResult: (mock, actor) => fire('Mock result', () => mockResultMail(mock._id || mock, actor)),
};
