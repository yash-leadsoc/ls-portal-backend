const User = require('../models/User');
const Domain = require('../models/Domain');
const { notifyUsers, createNotification } = require('./pushNotification');

const STATUS_LABEL = {
  on_training: 'On training',
  ongoing_interview: 'Ongoing interview',
  deployed: 'Deployed',
  sent: 'Profile sent',
  in_progress: 'In progress',
  selected: 'Selected',
  rejected: 'Not selected',
  on_hold: 'On hold',
};

function idOf(v) {
  if (!v) return null;
  return String(v._id || v.id || v);
}

async function domainEmployees(domainId, excludeId) {
  if (!domainId) return [];
  const users = await User.find({ role: 'employee', active: true, assignedDomains: domainId }).select('_id');
  return users.map((u) => u._id).filter((id) => String(id) !== String(excludeId));
}

async function domainName(domainId) {
  const d = await Domain.findById(domainId).select('name');
  return d ? d.name : 'your domain';
}

const rules = {
  async 'material.created'(req, body) {
    const doc = body.document || body;
    const domainId = idOf(doc.domain);
    const ids = await domainEmployees(domainId, req.user._id);
    if (!ids.length) return;
    await notifyUsers(ids, {
      type: 'MATERIAL_ADDED',
      title: 'New learning material',
      body: `"${doc.title}" was added to ${await domainName(domainId)}.`,
      url: `/domain/${domainId}`,
    });
  },

  async 'checklist.created'(req, body) {
    const c = body.checklist;
    if (!c) return;
    const domainId = idOf(c.domain);
    const ids = await domainEmployees(domainId, req.user._id);
    if (!ids.length) return;
    await notifyUsers(ids, {
      type: 'CHECKLIST_ADDED',
      title: 'New checklist available',
      body: `"${c.title}" is ready for ${await domainName(domainId)}.`,
      url: `/checklist/${idOf(c)}`,
    });
  },

  async 'writeup.created'(req, body) {
    const w = body.writeup;
    if (!w) return;
    const domainId = idOf(w.domain);
    const ids = await domainEmployees(domainId, req.user._id);
    if (!ids.length) return;
    await notifyUsers(ids, {
      type: 'WRITEUP_ADDED',
      title: 'New write-up assigned',
      body: `"${w.title}" is ready for ${await domainName(domainId)}.`,
      url: `/writeup/${idOf(w)}`,
    });
  },

  async 'exercise.created'(req, body) {
    const ex = body.exercise;
    if (!ex) return;
    const domainId = idOf(ex.domain);
    const ids = await domainEmployees(domainId, req.user._id);
    if (!ids.length) return;
    await notifyUsers(ids, {
      type: 'EXERCISE_ADDED',
      title: 'New exercise',
      body: `"${ex.title}" was added to ${await domainName(domainId)}.`,
      url: `/domain/${domainId}`,
    });
  },

  async 'mock.scored'(req, body) {
    const m = body.mock;
    if (!m) return;
    const scoreText = m.score != null ? ` You scored ${m.score}/10.` : '';
    await createNotification({
      userId: idOf(m.employee),
      type: 'MOCK_INTERVIEW_RESULT',
      title: m.status === 'cancelled' ? 'Mock interview cancelled' : 'Mock interview feedback',
      body: m.status === 'cancelled' ? 'Your mock interview was cancelled.' : `Your mock interview has been reviewed.${scoreText}`,
      url: '/interviews',
    });
  },

  async 'client.created'(req, body) {
    const c = body.client;
    if (!c) return;
    await createNotification({
      userId: idOf(c.employee),
      type: 'CLIENT_INTERVIEW',
      title: 'Profile shared with client',
      body: `Your profile was sent to ${c.client}${c.role ? ` for ${c.role}` : ''}.`,
      url: '/interviews',
    });
  },

  async 'client.updated'(req, body) {
    const c = body.client;
    if (!c) return;
    await createNotification({
      userId: idOf(c.employee),
      type: 'CLIENT_INTERVIEW',
      title: `Update from ${c.client}`,
      body: `Status: ${STATUS_LABEL[c.status] || c.status}.`,
      url: '/interviews',
    });
  },

  async 'status.changed'(req, body) {
    const u = body.user;
    if (!u || u.role !== 'employee' || !req.body.jobStatus) return;
    await createNotification({
      userId: idOf(u),
      type: 'STATUS_CHANGED',
      title: 'Your status was updated',
      body: `Your status is now: ${STATUS_LABEL[u.jobStatus] || u.jobStatus}.`,
      url: '/',
    });
  },

  async 'domains.assigned'(req) {
    await createNotification({
      userId: req.params.id,
      type: 'DOMAINS_ASSIGNED',
      title: 'Learning domains updated',
      body: 'Your assigned learning domains have been updated. Open the portal to see them.',
      url: '/',
    });
  },
};

function notifyAfter(event) {
  const rule = rules[event];
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400 && rule && body) {
        setImmediate(() => {
          Promise.resolve(rule(req, body)).catch(() => {});
        });
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { notifyAfter };
