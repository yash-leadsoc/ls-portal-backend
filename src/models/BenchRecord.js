const mongoose = require('mongoose');

const BENCH_STATUSES = [
  'Open',
  'Open - Under Training',
  'PO',
  'YTO',
  'Resigned',
  'Pending Exit',
  'Onboarded',
  'Exited',
];

const commentSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    text: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const historySchema = new mongoose.Schema(
  {
    field: { type: String, default: 'status' },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
  },
  { _id: false }
);

const benchRecordSchema = new mongoose.Schema(
  {
    empId: { type: String, required: true, unique: true, trim: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    buCode: { type: String, default: '', trim: true },
    businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, default: 'Open' },
    clientName: { type: String, default: '' },
    benchStart: { type: Date, default: null },
    source: { type: String, default: '' },
    doj: { type: Date, default: null },
    expYears: { type: Number, default: null },
    skill: { type: String, default: '' },
    buOwner: { type: String, default: '' },
    interviewRejects: { type: String, default: '' },
    interviewRejectCount: { type: Number, default: 0 },
    screenRejects: { type: String, default: '' },
    screenRejectCount: { type: Number, default: 0 },
    locationPreference: { type: String, default: '' },
    salesEffort: { type: String, default: '' },
    comments: { type: [commentSchema], default: [] },
    history: { type: [historySchema], default: [] },
    lastImportedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

benchRecordSchema.index({ buCode: 1, status: 1 });
benchRecordSchema.index({ businessUnit: 1 });
benchRecordSchema.index({ 'comments.date': 1 });
benchRecordSchema.index({ 'history.at': 1 });

benchRecordSchema.statics.STATUSES = BENCH_STATUSES;

module.exports = mongoose.model('BenchRecord', benchRecordSchema);
