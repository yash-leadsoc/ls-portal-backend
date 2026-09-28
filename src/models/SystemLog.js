const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    level: { type: String, enum: ['info', 'warn', 'error', 'alert'], required: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    source: { type: String, default: 'system' },
    message: { type: String, required: true },
    key: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    meta: { type: Object, default: {} },
  },
  { versionKey: false }
);

systemLogSchema.index({ at: 1 }, { expireAfterSeconds: Number(process.env.SYSTEM_LOG_RETENTION_DAYS || 90) * 24 * 60 * 60 });
systemLogSchema.index({ level: 1, at: -1 });
systemLogSchema.index({ key: 1, resolvedAt: 1 });

module.exports = mongoose.model('SystemLog', systemLogSchema);
