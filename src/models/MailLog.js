const mongoose = require('mongoose');

const mailLogSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true },
    to: { type: String, default: '' },
    cc: { type: String, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    subject: { type: String, default: '' },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

mailLogSchema.index({ kind: 1, user: 1, createdAt: -1 });
mailLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('MailLog', mailLogSchema);
