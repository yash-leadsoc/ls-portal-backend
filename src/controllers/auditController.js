const AuditLog = require('../models/AuditLog');
const escapeRegex = require('../utils/escapeRegex');
const { logAudit } = require('../utils/audit');

exports.list = async (req, res) => {
  try {
    const { actor, action, entity, from, to, q, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (req.user.role === 'admin' || req.user.role === 'cto') {
    } else if (req.user.role === 'manager') {
      filter.businessUnit = req.user._id;
    } else {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (actor) filter.actor = actor;
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }
    if (q) filter.$or = [{ entityLabel: new RegExp(escapeRegex(q), 'i') }, { actorName: new RegExp(escapeRegex(q), 'i') }];

    const lim = Math.min(Number(limit) || 50, 200);
    const skip = (Math.max(Number(page), 1) - 1) * lim;

    const [rows, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ rows, total, page: Math.max(Number(page), 1), limit: lim });
  } catch (e) {
    res.status(500).json({ message: 'Could not load logs' });
  }
};

exports.record = async (req, res) => {
  const { action, entity, entityId, entityLabel, meta } = req.body || {};
  if (!action) return res.status(400).json({ message: 'action is required' });
  await logAudit(req, { action, entity, entityId, entityLabel, meta });
  res.status(201).json({ ok: true });
};

exports.insights = async (req, res) => {
  try {
    const match = {};
    if (req.user.role === 'bu') match.businessUnit = req.user._id;
    else if (req.user.role !== 'admin'&& req.user.role !== 'cto') return res.status(403).json({ message: 'Forbidden' });

    const { from, to } = req.query;
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) { const e = new Date(to); e.setHours(23,59,59,999); match.createdAt.$lte = e; }
    }

    const [byAction, byEntity, byDay, byRole, topActors, focusLost] = await Promise.all([
      AuditLog.aggregate([{ $match: match }, { $group: { _id: '$action', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      AuditLog.aggregate([{ $match: match }, { $group: { _id: '$entity', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      AuditLog.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      AuditLog.aggregate([{ $match: match }, { $group: { _id: '$actorRole', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      AuditLog.aggregate([
        { $match: match },
        { $group: { _id: { id: '$actor', name: '$actorName' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: 10 },
      ]),
      AuditLog.aggregate([
        { $match: { ...match, action: 'writeup.focus_lost' } },
        { $group: { _id: '$actorName', n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: 10 },
      ]),
    ]);

    res.json({
      byAction:  byAction.map(x => ({ name: x._id || 'unknown', value: x.n })),
      byEntity:  byEntity.map(x => ({ name: x._id || 'unknown', value: x.n })),
      byDay:     byDay.map(x => ({ date: x._id, value: x.n })),
      byRole:    byRole.map(x => ({ name: x._id || 'unknown', value: x.n })),
      topActors: topActors.map(x => ({ name: x._id.name || 'unknown', value: x.n })),
      focusLost: focusLost.map(x => ({ name: x._id || 'unknown', value: x.n })),
    });
  } catch (e) {
    res.status(500).json({ message: 'Could not load insights' });
  }
};
