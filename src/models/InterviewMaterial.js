const mongoose = require('mongoose');
const interviewMaterialSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  title: { type: String, required: true },
  kind: { type: String, enum: ['question_bank', 'study_material', 'other'], default: 'question_bank' },
  forRole: { type: String, default: '' },
  fileUrl: { type: String, default: null },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploaderName: { type: String, default: '' },
  uploaderEmployeeCode: { type: String, default: '' },
  uploaderRole: { type: String, default: '' },
  active: { type: Boolean, default: true },
}, { timestamps: true });
module.exports = mongoose.model('InterviewMaterial', interviewMaterialSchema);
