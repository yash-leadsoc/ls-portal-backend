const mongoose = require('mongoose');
const historySchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['mock', 'client', 'status', 'availability'], required: true },
  title: { type: String, default: '' },
  detail: { type: String, default: '' },
  meta: { type: Object, default: {} },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
  businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  at: { type: Date, default: Date.now },
}, { timestamps: true });
module.exports = mongoose.model('InterviewHistory', historySchema);
