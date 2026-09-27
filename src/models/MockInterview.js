const mongoose = require('mongoose');
const mockSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  forRole: { type: String, default: '' },
  scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scheduledAt: { type: Date, required: true },
  durationMins: { type: Number, default: 45 },
  meetLink: { type: String, default: null },
  meetEventId: { type: String, default: null },
  status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
  score: { type: Number, default: null },
  review: { type: String, default: '' },
  businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });
mockSchema.index({ employee: 1 });
mockSchema.index({ businessUnit: 1 });
module.exports = mongoose.model('MockInterview', mockSchema);
