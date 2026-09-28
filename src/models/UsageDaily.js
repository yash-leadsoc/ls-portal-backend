const mongoose = require('mongoose');

const usageDailySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    day: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, default: '' },
    businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    path: { type: String, required: true },
    views: { type: Number, default: 0 },
    ms: { type: Number, default: 0 },
  },
  { versionKey: false }
);

usageDailySchema.index({ day: 1, user: 1, path: 1 }, { unique: true });
usageDailySchema.index({ date: 1 }, { expireAfterSeconds: Number(process.env.USAGE_RETENTION_DAYS || 180) * 24 * 60 * 60 });
usageDailySchema.index({ user: 1, date: -1 });

module.exports = mongoose.model('UsageDaily', usageDailySchema);
