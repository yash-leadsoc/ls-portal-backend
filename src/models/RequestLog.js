const mongoose = require('mongoose');

const requestLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    kind: { type: String, enum: ['mutation', 'error'], required: true },
    method: String,
    route: String,
    path: String,
    status: Number,
    ms: Number,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, default: '' },
    role: { type: String, default: '' },
    businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ip: String,
    userAgent: String,
    error: String,
    stack: String,
  },
  { versionKey: false }
);

requestLogSchema.index({ at: 1 }, { expireAfterSeconds: Number(process.env.REQUEST_LOG_RETENTION_DAYS || 30) * 24 * 60 * 60 });
requestLogSchema.index({ kind: 1, at: -1 });
requestLogSchema.index({ status: 1, at: -1 });
requestLogSchema.index({ user: 1, at: -1 });
requestLogSchema.index({ route: 1, at: -1 });

module.exports = mongoose.model('RequestLog', requestLogSchema);
