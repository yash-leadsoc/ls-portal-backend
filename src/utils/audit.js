const AuditLog = require('../models/AuditLog');

function buFor(user = {}) {
  if (user.role === 'bu') return user._id;
  if (user.role === 'manager' || user.role === 'employee') return user.businessUnit || null;
  return null;
}

function clientInfo(req) {
  if (!req) return { ip: '', userAgent: '' };
  const ua = typeof req.get === 'function' ? req.get('user-agent') || '' : '';
  return { ip: req.ip || '', userAgent: ua.slice(0, 300) };
}

async function logAudit(req, { action, entity, entityId, entityLabel, meta, actor } = {}) {
  try {
    const u = actor || (req && req.user) || {};
    await AuditLog.create({
      actor: u._id || null,
      actorName: u.name || '',
      actorRole: u.role || '',
      businessUnit: buFor(u),
      action,
      entity: entity || '',
      entityId: entityId != null ? String(entityId) : null,
      entityLabel: entityLabel || '',
      meta: meta || {},
      ...clientInfo(req),
    });
  } catch (e) {}
}

module.exports = { logAudit, clientInfo };
