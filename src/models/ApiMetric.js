const mongoose = require('mongoose');

const apiMetricSchema = new mongoose.Schema(
  {
    hour: { type: Date, required: true },
    method: { type: String, required: true },
    route: { type: String, required: true },
    count: { type: Number, default: 0 },
    errors4xx: { type: Number, default: 0 },
    errors5xx: { type: Number, default: 0 },
    totalMs: { type: Number, default: 0 },
    maxMs: { type: Number, default: 0 },
    b0: { type: Number, default: 0 },
    b1: { type: Number, default: 0 },
    b2: { type: Number, default: 0 },
    b3: { type: Number, default: 0 },
    b4: { type: Number, default: 0 },
    b5: { type: Number, default: 0 },
    b6: { type: Number, default: 0 },
    b7: { type: Number, default: 0 },
  },
  { versionKey: false }
);

apiMetricSchema.index({ hour: 1, method: 1, route: 1 }, { unique: true });
apiMetricSchema.index({ hour: 1 }, { expireAfterSeconds: Number(process.env.API_METRIC_RETENTION_DAYS || 90) * 24 * 60 * 60 });

apiMetricSchema.statics.BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, Infinity];

module.exports = mongoose.model('ApiMetric', apiMetricSchema);
