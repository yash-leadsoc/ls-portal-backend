const AuditLog = require('../models/AuditLog');

function buFor(user = {}) {
  if (user.role === 'bu') return user._id;
  if (user.role === 'manager' || user.role === 'employee') return user.businessUnit || null;
  return null;
}

async function logAudit(req, { action, entity, entityId, entityLabel, meta } = {}) {
  try {
    const u = (req && req.user) || {};
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
    });
  } catch (e) {
  }
}

module.exports = { logAudit };
