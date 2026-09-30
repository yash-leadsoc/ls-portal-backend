const crypto = require('crypto');
const mongoose = require('mongoose');
const BenchRecord = require('../models/BenchRecord');
const User = require('../models/User');
const { logAudit } = require('../utils/audit');

const STATUSES = BenchRecord.STATUSES;
const OFF_BENCH = new Set(['Onboarded', 'Exited']);
const DAY = 24 * 60 * 60 * 1000;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 1500;
const EXP_BUCKETS = ['0 to 3 Yrs', '3+ to 5 Yrs', '5+ to 8 Yrs', '8+ Yrs'];
const AGE_BUCKETS = ['0-30', '31-60', '61-90', '90+'];

const text = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function dateOnly(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(y, +m[2] - 1, +m[1]));
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function canonicalStatus(v) {
  const s = text(v, 60);
  if (!s) return 'Open';
  const hit = STATUSES.find((x) => x.toLowerCase() === s.toLowerCase());
  if (hit) return hit;
  const low = s.toLowerCase();
  if (low.includes('training')) return 'Open - Under Training';
  if (low === 'pending onboarding') return 'PO';
  if (low === 'yet to offboard') return 'YTO';
  return s;
}

function jobStatusFor(status) {
  if (status === 'Onboarded') return 'deployed';
  if (status === 'PO') return 'ongoing_interview';
  return 'on_training';
}

function ageingDays(r, now = Date.now()) {
  if (!r.benchStart) return null;
  return Math.max(0, Math.floor((now - new Date(r.benchStart).getTime()) / DAY));
}

function ageBucket(days) {
  if (days == null) return null;
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function expBucket(y) {
  if (y == null) return null;
  if (y <= 3) return '0 to 3 Yrs';
  if (y <= 5) return '3+ to 5 Yrs';
  if (y <= 8) return '5+ to 8 Yrs';
  return '8+ Yrs';
}

function salesCodes(v) {
  return text(v, 300)
    .split(/[,;/\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

function actor(req) {
  return { by: req.user._id, byName: req.user.name || '' };
}

function shapeRecord(r, { commentLimit = 12 } = {}) {
  const comments = [...(r.comments || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  return {
    id: r._id,
    empId: r.empId,
    employee: r.employee,
    name: r.name,
    buCode: r.buCode,
    businessUnit: r.businessUnit,
    businessUnitName: r.businessUnitName || '',
    status: r.status,
    clientName: r.clientName,
    benchStart: r.benchStart,
    ageing: ageingDays(r),
    source: r.source,
    doj: r.doj,
    expYears: r.expYears,
    skill: r.skill,
    buOwner: r.buOwner,
    interviewRejects: r.interviewRejects,
    interviewRejectCount: r.interviewRejectCount || 0,
    screenRejects: r.screenRejects,
    screenRejectCount: r.screenRejectCount || 0,
    locationPreference: r.locationPreference,
    salesEffort: r.salesEffort,
    onBench: !OFF_BENCH.has(r.status),
    commentCount: comments.length,
    comments: commentLimit == null ? comments : comments.slice(0, commentLimit),
    history: commentLimit == null ? [...(r.history || [])].reverse() : undefined,
    updatedAt: r.updatedAt,
  };
}

function generatePassword() {
  return `Ls@${crypto.randomBytes(4).toString('hex')}`;
}

async function runPool(items, size, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

function cleanRow(r, i) {
  const comments = (Array.isArray(r.comments) ? r.comments : [])
    .map((c) => ({ date: dateOnly(c && c.date), text: text(c && c.text, 2000) }))
    .filter((c) => c.text && c.date && c.date !== 'invalid');
  return {
    row: Number(r.row) || i + 2,
    empId: text(r.empId, 40),
    name: text(r.name, 120),
    email: text(r.email, 160).toLowerCase(),
    buCode: text(r.buCode, 40),
    status: canonicalStatus(r.status),
    clientName: text(r.clientName, 160),
    benchStart: dateOnly(r.benchStart),
    source: text(r.source, 120),
    doj: dateOnly(r.doj),
    expYears: num(r.expYears),
    skill: text(r.skill, 160),
    buOwner: text(r.buOwner, 80),
    interviewRejects: text(r.interviewRejects, 500),
    interviewRejectCount: num(r.interviewRejectCount) || 0,
    screenRejects: text(r.screenRejects, 500),
    screenRejectCount: num(r.screenRejectCount) || 0,
    locationPreference: text(r.locationPreference, 160),
    salesEffort: text(r.salesEffort, 160),
    comments,
  };
}

exports.importRows = async (req, res) => {
  const input = Array.isArray(req.body.rows) ? req.body.rows : [];
  const dryRun = req.body.dryRun !== false;
  const createAccounts = req.body.createAccounts !== false;
  const buMap = req.body.buMap && typeof req.body.buMap === 'object' ? req.body.buMap : {};
  if (!input.length) return res.status(400).json({ message: 'No engineer rows found in the file' });
  if (input.length > MAX_ROWS) return res.status(400).json({ message: `Import at most ${MAX_ROWS} rows at a time` });

  const rows = input.map(cleanRow);

  const buIds = [...new Set(Object.values(buMap).filter((v) => mongoose.isValidObjectId(v)))];
  const bus = await User.find({ _id: { $in: buIds }, role: 'bu' }).select('_id name').lean();
  const validBu = new Map(bus.map((b) => [String(b._id), b]));

  const empIds = rows.map((r) => r.empId).filter(Boolean);
  const [existingRecords, users] = await Promise.all([
    BenchRecord.find({ empId: { $in: empIds } }),
    User.find({}).select('email employeeCode role').lean(),
  ]);
  const recordByEmp = new Map(existingRecords.map((r) => [r.empId.toLowerCase(), r]));
  const userByCode = new Map(users.filter((u) => u.employeeCode).map((u) => [String(u.employeeCode).toLowerCase(), u]));
  const takenEmails = new Set(users.map((u) => String(u.email || '').toLowerCase()));
  const emailDomain = process.env.BENCH_EMAIL_DOMAIN || 'bench.leadsoc.local';

  const seen = {};
  rows.forEach((r) => {
    if (r.empId) seen[r.empId.toLowerCase()] = (seen[r.empId.toLowerCase()] || 0) + 1;
  });

  const checked = rows.map((r) => {
    const errors = [];
    if (!r.empId) errors.push('EMP ID is required');
    else if (seen[r.empId.toLowerCase()] > 1) errors.push('EMP ID appears more than once in the file');
    if (!r.name) errors.push('Candidate name is required');
    if (r.benchStart === 'invalid') errors.push('Bench Start Date is not valid');
    if (r.doj === 'invalid') errors.push('DOJ is not valid');

    const mappedBu = r.buCode ? buMap[r.buCode] : null;
    const bu = mappedBu ? validBu.get(String(mappedBu)) : null;
    if (!r.buCode) errors.push('BU is required');
    else if (!bu) errors.push(`BU "${r.buCode}" is not mapped to a Business Unit`);

    const existing = r.empId ? recordByEmp.get(r.empId.toLowerCase()) : null;
    const user = r.empId ? userByCode.get(r.empId.toLowerCase()) : null;
    if (user && user.role !== 'employee') errors.push(`EMP ID belongs to a ${user.role} account`);

    let email = '';
    if (!user && createAccounts && r.empId) {
      email = r.email && EMAIL_RX.test(r.email) ? r.email : `${r.empId.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@${emailDomain}`;
      if (takenEmails.has(email)) errors.push(`Email ${email} is already used by another account`);
    }

    return {
      ...r,
      errors,
      bu,
      existing,
      user,
      email,
      action: existing ? 'update' : 'new',
      account: user ? 'linked' : createAccounts ? 'create' : 'none',
    };
  });

  const summary = (list) =>
    list.map((r) => ({
      row: r.row,
      empId: r.empId,
      name: r.name,
      buCode: r.buCode,
      buName: r.bu ? r.bu.name : '',
      status: r.status,
      action: r.result || (r.errors.length ? 'invalid' : r.action),
      account: r.account,
      login: r.login || undefined,
      password: r.password || undefined,
      comments: r.comments.length,
      errors: r.errors,
    }));

  const valid = checked.filter((r) => !r.errors.length);
  if (dryRun) {
    return res.json({
      dryRun: true,
      total: checked.length,
      valid: valid.length,
      invalid: checked.length - valid.length,
      newRecords: valid.filter((r) => r.action === 'new').length,
      updates: valid.filter((r) => r.action === 'update').length,
      newAccounts: valid.filter((r) => r.account === 'create').length,
      results: summary(checked),
    });
  }

  const who = actor(req);
  await runPool(valid, 5, async (r) => {
    try {
      let user = r.user;
      if (!user && r.account === 'create') {
        const password = generatePassword();
        const u = new User({
          name: r.name,
          email: r.email,
          employeeCode: r.empId,
          role: 'employee',
          createdBy: req.user._id,
          businessUnit: r.bu._id,
          benchStart: r.benchStart || new Date(),
          jobStatus: jobStatusFor(r.status),
          deployedAt: r.status === 'Onboarded' ? new Date() : null,
          preferredLocation: r.locationPreference,
          skills: r.skill ? r.skill.split(/[,/]+/).map((s) => s.trim()).filter(Boolean) : [],
        });
        await u.setPassword(password);
        await u.save();
        user = u;
        r.login = r.empId;
        r.password = password;
      } else if (user) {
        const set = { businessUnit: r.bu._id };
        if (r.benchStart) set.benchStart = r.benchStart;
        await User.updateOne({ _id: user._id }, { $set: set });
      }

      const rec = r.existing || new BenchRecord({ empId: r.empId });
      const prevStatus = r.existing ? rec.status : null;
      Object.assign(rec, {
        employee: user ? user._id : rec.employee || null,
        name: r.name,
        buCode: r.buCode,
        businessUnit: r.bu._id,
        status: r.status,
        clientName: r.clientName,
        benchStart: r.benchStart || null,
        source: r.source,
        doj: r.doj || null,
        expYears: r.expYears,
        skill: r.skill,
        buOwner: r.buOwner,
        interviewRejects: r.interviewRejects,
        interviewRejectCount: r.interviewRejectCount,
        screenRejects: r.screenRejects,
        screenRejectCount: r.screenRejectCount,
        locationPreference: r.locationPreference,
        salesEffort: r.salesEffort,
        lastImportedAt: new Date(),
      });
      if (prevStatus !== r.status) {
        rec.history.push({ field: 'status', from: prevStatus || '', to: r.status, ...who });
      }
      for (const c of r.comments) {
        const same = rec.comments.find((x) => new Date(x.date).getTime() === c.date.getTime());
        if (!same) rec.comments.push({ date: c.date, text: c.text, ...who, at: new Date() });
        else if (same.text !== c.text) {
          same.text = c.text;
          same.at = new Date();
        }
      }
      await rec.save();
      r.result = r.existing ? 'updated' : 'created';
    } catch (e) {
      r.result = 'failed';
      r.errors.push(e && e.code === 11000 ? 'Duplicate EMP ID or email' : 'Could not save this row');
    }
  });

  const created = checked.filter((r) => r.result === 'created').length;
  const updated = checked.filter((r) => r.result === 'updated').length;
  const accounts = checked.filter((r) => r.password).length;
  await logAudit(req, {
    action: 'import',
    entity: 'bench',
    entityLabel: `Bench list: ${created} new, ${updated} updated, ${accounts} accounts`,
    meta: { total: checked.length, created, updated, accounts },
  });

  res.json({
    dryRun: false,
    total: checked.length,
    created,
    updated,
    accounts,
    skipped: checked.length - created - updated,
    results: summary(checked),
  });
};

async function withBuNames(records) {
  const ids = [...new Set(records.map((r) => String(r.businessUnit || '')).filter(Boolean))];
  const bus = await User.find({ _id: { $in: ids } }).select('name').lean();
  const names = new Map(bus.map((b) => [String(b._id), b.name]));
  return records.map((r) => ({ ...r, businessUnitName: names.get(String(r.businessUnit)) || '' }));
}

exports.list = async (req, res) => {
  const records = await BenchRecord.find({}).sort({ buCode: 1, benchStart: 1 }).lean();
  const named = await withBuNames(records);
  const statuses = [...new Set([...STATUSES, ...records.map((r) => r.status)])];
  const full = req.query.full === '1';
  res.json({ records: named.map((r) => shapeRecord(r, { commentLimit: full ? null : 12 })), statuses });
};

exports.getOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
  const r = await BenchRecord.findById(req.params.id).lean();
  if (!r) return res.status(404).json({ message: 'Not found' });
  const [named] = await withBuNames([r]);
  res.json({ record: shapeRecord(named, { commentLimit: null }) });
};

const EDITABLE = {
  name: (v) => text(v, 120),
  buCode: (v) => text(v, 40),
  status: canonicalStatus,
  clientName: (v) => text(v, 160),
  source: (v) => text(v, 120),
  expYears: num,
  skill: (v) => text(v, 160),
  buOwner: (v) => text(v, 80),
  interviewRejects: (v) => text(v, 500),
  interviewRejectCount: (v) => num(v) || 0,
  screenRejects: (v) => text(v, 500),
  screenRejectCount: (v) => num(v) || 0,
  locationPreference: (v) => text(v, 160),
  salesEffort: (v) => text(v, 160),
};

exports.update = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
  const rec = await BenchRecord.findById(req.params.id);
  if (!rec) return res.status(404).json({ message: 'Not found' });
  const who = actor(req);
  const body = req.body || {};

  for (const [key, clean] of Object.entries(EDITABLE)) {
    if (body[key] === undefined) continue;
    const next = clean(body[key]);
    const prev = rec[key];
    if (String(prev ?? '') !== String(next ?? '')) {
      if (key === 'status' || key === 'clientName') rec.history.push({ field: key, from: String(prev ?? ''), to: String(next ?? ''), ...who });
      rec[key] = next;
    }
  }
  for (const key of ['benchStart', 'doj']) {
    if (body[key] === undefined) continue;
    const d = dateOnly(body[key]);
    if (d === 'invalid') return res.status(400).json({ message: `${key === 'doj' ? 'DOJ' : 'Bench start date'} is not valid` });
    if (String(rec[key] || '') !== String(d || '')) {
      if (key === 'benchStart') rec.history.push({ field: key, from: rec[key] ? rec[key].toISOString().slice(0, 10) : '', to: d ? d.toISOString().slice(0, 10) : '', ...who });
      rec[key] = d;
    }
  }
  if (body.businessUnit !== undefined) {
    const bu = mongoose.isValidObjectId(body.businessUnit) ? await User.findOne({ _id: body.businessUnit, role: 'bu' }).select('_id') : null;
    if (!bu) return res.status(400).json({ message: 'Select a valid Business Unit' });
    rec.businessUnit = bu._id;
  }
  await rec.save();

  if (rec.employee) {
    const set = { businessUnit: rec.businessUnit };
    if (rec.benchStart) set.benchStart = rec.benchStart;
    const js = jobStatusFor(rec.status);
    set.jobStatus = js;
    set.deployedAt = js === 'deployed' ? new Date() : null;
    const current = await User.findById(rec.employee).select('jobStatus deployedAt');
    if (current && current.jobStatus === 'deployed' && js === 'deployed') set.deployedAt = current.deployedAt || new Date();
    await User.updateOne({ _id: rec.employee }, { $set: set });
  }

  await logAudit(req, { action: 'update', entity: 'bench', entityId: rec._id, entityLabel: `${rec.empId} ${rec.name}` });
  const [named] = await withBuNames([rec.toObject()]);
  res.json({ record: shapeRecord(named, { commentLimit: null }) });
};

exports.addComment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
  const date = dateOnly(req.body.date || new Date().toISOString().slice(0, 10));
  const body = text(req.body.text, 2000);
  if (!body) return res.status(400).json({ message: 'Comment cannot be empty' });
  if (!date || date === 'invalid') return res.status(400).json({ message: 'Comment date is not valid' });
  const rec = await BenchRecord.findById(req.params.id);
  if (!rec) return res.status(404).json({ message: 'Not found' });

  const same = rec.comments.find((c) => new Date(c.date).getTime() === date.getTime());
  if (same) {
    same.text = body;
    same.at = new Date();
    Object.assign(same, actor(req));
  } else {
    rec.comments.push({ date, text: body, ...actor(req), at: new Date() });
  }
  await rec.save();
  const [named] = await withBuNames([rec.toObject()]);
  res.json({ record: shapeRecord(named, { commentLimit: null }) });
};

exports.deleteComment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
  const rec = await BenchRecord.findById(req.params.id);
  if (!rec) return res.status(404).json({ message: 'Not found' });
  const c = rec.comments.id(req.params.commentId);
  if (!c) return res.status(404).json({ message: 'Comment not found' });
  c.deleteOne();
  await rec.save();
  const [named] = await withBuNames([rec.toObject()]);
  res.json({ record: shapeRecord(named, { commentLimit: null }) });
};

function periodBounds(kind, dateStr) {
  const base = dateOnly(dateStr || new Date().toISOString().slice(0, 10));
  const d = base && base !== 'invalid' ? base : dateOnly(new Date().toISOString().slice(0, 10));
  if (kind === 'month') {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return { start, end, label: start.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  const dow = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - dow * DAY);
  const end = new Date(start.getTime() + 7 * DAY);
  const fmt = (x) => x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return { start, end, label: `${fmt(start)} – ${fmt(new Date(end.getTime() - DAY))}` };
}

function wasOnBenchAt(r, t) {
  if (!r.benchStart || new Date(r.benchStart).getTime() > t) return false;
  const offs = (r.history || []).filter((h) => h.field === 'status' && OFF_BENCH.has(h.to) && new Date(h.at).getTime() <= t);
  const backs = (r.history || []).filter((h) => h.field === 'status' && !OFF_BENCH.has(h.to) && new Date(h.at).getTime() <= t);
  if (!offs.length) return true;
  const lastOff = Math.max(...offs.map((h) => new Date(h.at).getTime()));
  const lastBack = backs.length ? Math.max(...backs.map((h) => new Date(h.at).getTime())) : 0;
  return lastBack > lastOff;
}

exports.report = async (req, res) => {
  const kind = req.query.period === 'month' ? 'month' : 'week';
  const { start, end, label } = periodBounds(kind, req.query.date);
  const all = await withBuNames(await BenchRecord.find({}).lean());
  const now = Date.now();
  const active = all.filter((r) => !OFF_BENCH.has(r.status));

  const buCodes = [...new Set(all.map((r) => r.buCode || 'Unassigned'))].sort();
  const statusRows = ['PO', 'YTO', 'Resigned', 'Open - Under Training', 'Pending Exit'];
  const matrix = {};
  const add = (row, bu, n = 1) => {
    matrix[row] = matrix[row] || {};
    matrix[row][bu] = (matrix[row][bu] || 0) + n;
  };
  active.forEach((r) => {
    const bu = r.buCode || 'Unassigned';
    add('Total Bench', bu);
    if (statusRows.includes(r.status)) add(r.status, bu);
    else add('Rest of the Bench / Open', bu);
  });
  const matrixRows = ['Total Bench', ...statusRows, 'Rest of the Bench / Open'].map((row) => {
    const cells = buCodes.map((bu) => (matrix[row] && matrix[row][bu]) || 0);
    return { label: row === 'PO' ? 'Pending Onboarding (PO)' : row === 'YTO' ? 'Yet To Offboard (YTO)' : row, cells, total: cells.reduce((a, b) => a + b, 0) };
  });

  const expSplit = buCodes.map((bu) => {
    const list = active.filter((r) => (r.buCode || 'Unassigned') === bu);
    const cells = EXP_BUCKETS.map((b) => list.filter((r) => expBucket(r.expYears) === b).length);
    return { bu, cells, total: cells.reduce((a, b) => a + b, 0) };
  });

  const redFlags = buCodes.map((bu) => {
    const list = active.filter((r) => (r.buCode || 'Unassigned') === bu);
    return {
      bu,
      over90: list.filter((r) => (ageingDays(r, now) || 0) >= 90).length,
      rejects3: list.filter((r) => (r.interviewRejectCount || 0) >= 3).length,
    };
  });

  const skills = {};
  active.forEach((r) => {
    const key = `${r.buCode || 'Unassigned'}||${r.skill || 'Unspecified'}`;
    skills[key] = skills[key] || { bu: r.buCode || 'Unassigned', skill: r.skill || 'Unspecified', cells: [0, 0, 0, 0], total: 0 };
    const i = EXP_BUCKETS.indexOf(expBucket(r.expYears));
    if (i >= 0) skills[key].cells[i] += 1;
    skills[key].total += 1;
  });

  const salesBase = active.filter((r) => !['Resigned', 'YTO'].includes(r.status)).length;
  const sales = {};
  active.forEach((r) => salesCodes(r.salesEffort).forEach((c) => (sales[c] = (sales[c] || 0) + 1)));

  const locations = {};
  active.forEach((r) => {
    const parts = text(r.locationPreference).split(/[,;/]+/).map((x) => x.replace(/\(.*?\)/g, '').trim().toUpperCase()).filter(Boolean);
    (parts.length ? parts : ['NOT SPECIFIED']).forEach((p) => (locations[p] = (locations[p] || 0) + 1));
  });

  const ageing = AGE_BUCKETS.map((b) => ({ name: `${b} days`, value: active.filter((r) => ageBucket(ageingDays(r, now)) === b).length }));

  const inRange = (d) => d && new Date(d) >= start && new Date(d) < end;
  const joined = all.filter((r) => inRange(r.benchStart));
  const changes = [];
  all.forEach((r) =>
    (r.history || [])
      .filter((h) => inRange(h.at) && h.from !== '' )
      .forEach((h) => changes.push({ empId: r.empId, name: r.name, buCode: r.buCode, field: h.field, from: h.from, to: h.to, at: h.at, byName: h.byName }))
  );
  changes.sort((a, b) => new Date(b.at) - new Date(a.at));
  const movedTo = {};
  changes.filter((c) => c.field === 'status').forEach((c) => (movedTo[c.to] = (movedTo[c.to] || 0) + 1));

  const periodComments = [];
  all.forEach((r) =>
    (r.comments || [])
      .filter((c) => inRange(c.date))
      .forEach((c) => periodComments.push({ empId: r.empId, name: r.name, buCode: r.buCode, status: r.status, date: c.date, text: c.text, byName: c.byName }))
  );
  periodComments.sort((a, b) => new Date(b.date) - new Date(a.date) || a.name.localeCompare(b.name));
  const updatedIds = new Set(periodComments.map((c) => c.empId));
  const notUpdated = active
    .filter((r) => !updatedIds.has(r.empId))
    .map((r) => {
      const last = [...(r.comments || [])].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      return { empId: r.empId, name: r.name, buCode: r.buCode, status: r.status, ageing: ageingDays(r, now), lastUpdate: last ? last.date : null };
    })
    .sort((a, b) => (b.ageing || 0) - (a.ageing || 0));

  const trendPoints = [];
  for (let i = 11; i >= 0; i--) {
    let ps;
    let pe;
    let lbl;
    if (kind === 'month') {
      ps = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1));
      pe = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i + 1, 1));
      lbl = ps.toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    } else {
      ps = new Date(start.getTime() - i * 7 * DAY);
      pe = new Date(ps.getTime() + 7 * DAY);
      lbl = ps.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    }
    const t = Math.min(pe.getTime() - 1, now);
    trendPoints.push({
      period: lbl,
      onBench: all.filter((r) => wasOnBenchAt(r, t)).length,
      joined: all.filter((r) => r.benchStart && new Date(r.benchStart) >= ps && new Date(r.benchStart) < pe).length,
      movedOff: all.reduce(
        (n, r) => n + (r.history || []).filter((h) => h.field === 'status' && OFF_BENCH.has(h.to) && h.from !== '' && new Date(h.at) >= ps && new Date(h.at) < pe).length,
        0
      ),
      comments: all.reduce((n, r) => n + (r.comments || []).filter((c) => new Date(c.date) >= ps && new Date(c.date) < pe).length, 0),
    });
  }

  const statusCounts = {};
  all.forEach((r) => (statusCounts[r.status] = (statusCounts[r.status] || 0) + 1));

  res.json({
    period: { kind, label, start, end: new Date(end.getTime() - DAY) },
    kpis: {
      totalRecords: all.length,
      onBench: active.length,
      open: active.filter((r) => r.status === 'Open').length,
      underTraining: active.filter((r) => r.status === 'Open - Under Training').length,
      pendingOnboarding: active.filter((r) => r.status === 'PO').length,
      yetToOffboard: active.filter((r) => r.status === 'YTO').length,
      exits: active.filter((r) => ['Resigned', 'Pending Exit'].includes(r.status)).length,
      over90: active.filter((r) => (ageingDays(r, now) || 0) >= 90).length,
      avgAgeing: active.length ? Math.round(active.reduce((a, r) => a + (ageingDays(r, now) || 0), 0) / active.length) : 0,
      joinedInPeriod: joined.length,
      statusChangesInPeriod: changes.filter((c) => c.field === 'status').length,
      commentsInPeriod: periodComments.length,
      updatedInPeriod: updatedIds.size,
      notUpdatedInPeriod: notUpdated.length,
    },
    buCodes,
    matrix: matrixRows,
    expBuckets: EXP_BUCKETS,
    expSplit,
    redFlags,
    skills: Object.values(skills).sort((a, b) => a.bu.localeCompare(b.bu) || b.total - a.total),
    sales: Object.entries(sales).map(([code, count]) => ({ code, count, pct: salesBase ? Math.round((count / salesBase) * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count),
    salesBase,
    locations: Object.entries(locations).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    ageing,
    statusCounts: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
    joined: joined.map((r) => ({ empId: r.empId, name: r.name, buCode: r.buCode, benchStart: r.benchStart, skill: r.skill, status: r.status })),
    movedTo: Object.entries(movedTo).map(([name, value]) => ({ name, value })),
    changes,
    comments: periodComments,
    notUpdated,
    trend: trendPoints,
  });
};
