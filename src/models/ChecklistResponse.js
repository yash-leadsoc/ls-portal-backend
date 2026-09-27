const mongoose = require('mongoose');

const itemResponseSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, required: true },
    tried: { type: Boolean, default: false },
    understood: { type: Boolean, default: false },
    proficiency: { type: Number, default: 0 },
  },
  { _id: false }
);

const checklistResponseSchema = new mongoose.Schema(
  {
    checklist: { type: mongoose.Schema.Types.ObjectId, ref: 'Checklist', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    responses: [itemResponseSchema],
  },
  { timestamps: true }
);

checklistResponseSchema.index({ checklist: 1, employee: 1 }, { unique: true });

checklistResponseSchema.index({ employee: 1 });
module.exports = mongoose.model('ChecklistResponse', checklistResponseSchema);
