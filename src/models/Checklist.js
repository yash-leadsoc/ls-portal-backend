const mongoose = require('mongoose');

const checklistItemSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    category: { type: String, default: 'tool' },
    section: { type: String, default: '' },
    code: { type: String, default: '' },
    topic: { type: String, default: '' },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const checklistSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
    domain: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [checklistItemSchema],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

checklistSchema.index({ domain: 1, active: 1 });
checklistSchema.index({ document: 1, active: 1 });
module.exports = mongoose.model('Checklist', checklistSchema);
