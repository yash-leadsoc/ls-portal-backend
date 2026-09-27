const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    section: { type: String, default: 'General' },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const writeupSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
    domain: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    questions: [questionSchema],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

writeupSchema.index({ domain: 1, active: 1 });
writeupSchema.index({ document: 1, active: 1 });
module.exports = mongoose.model('Writeup', writeupSchema);
