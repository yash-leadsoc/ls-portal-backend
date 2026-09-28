const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    action: { type: String, required: true },
    entity: { type: String, default: '' },
    entityId: { type: String, default: null },
    entityLabel: { type: String, default: '' },

    meta: { type: Object, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
auditSchema.index({ businessUnit: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditSchema);
