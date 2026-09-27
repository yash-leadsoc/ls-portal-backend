const mongoose = require('mongoose');
const availabilitySchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  fromTime: { type: String, default: '' },
  toTime: { type: String, default: '' },
  note: { type: String, default: '' },
  businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });
availabilitySchema.index({ employee: 1, date: 1 });
module.exports = mongoose.model('Availability', availabilitySchema);
