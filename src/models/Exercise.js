const mongoose = require('mongoose');
const exerciseSchema = new mongoose.Schema({
  domain: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true },
  businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  title: { type: String, required: true },
  instructions: { type: String, default: '' },
  refType: { type: String, enum: ['file', 'link', 'none'], default: 'none' },
  refFileUrl: { type: String, default: null },
  refOriginalName: { type: String, default: '' },
  refLink: { type: String, default: null },
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });
exerciseSchema.index({ domain: 1, active: 1 });
module.exports = mongoose.model('Exercise', exerciseSchema);
