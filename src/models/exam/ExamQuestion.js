const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    set: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSet', required: true, index: true },
    title: { type: String, required: true }, description: String, images: [String],
    type: { type: String, enum: ['MCQ', 'MULTI_SELECT', 'TRUE_FALSE', 'SHORT_ANSWER', 'LONG_ANSWER'], required: true },
    options: [{ label: String, value: String }], correctAnswers: [String], modelAnswer: String, evaluationGuidelines: String,
    marks: { type: Number, required: true, min: 0 }, negativeMarks: { type: Number, default: 0, min: 0 },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' }, topic: String, explanation: String,
    order: { type: Number, default: 0 }
}, { timestamps: true });
module.exports = mongoose.models.ExamQuestion || mongoose.model('ExamQuestion', schema);
