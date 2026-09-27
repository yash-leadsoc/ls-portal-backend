const mongoose = require('mongoose');
const clientSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  client: { type: String, required: true },
  role: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['sent', 'in_progress', 'selected', 'rejected', 'on_hold'], default: 'sent' },
  performance: { type: String, default: '' },
  updates: [{
    at: { type: Date, default: Date.now },
    note: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: String,
  }],
  businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });
clientSchema.index({ employee: 1 });
clientSchema.index({ businessUnit: 1 });
module.exports = mongoose.model('ClientInterview', clientSchema);
