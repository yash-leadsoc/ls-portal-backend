const mongoose = require('mongoose');

const ExamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    instructions: { type: String, trim: true, maxlength: 10000 },
    category: { type: String, trim: true, maxlength: 100 },
    durationMinutes: { type: Number, required: true, min: 1, max: 1440 },
    maximumMarks: { type: Number, required: true, min: 0 },
    passingMarks: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    randomizeQuestions: { type: Boolean, default: false },
    randomizeOptions: { type: Boolean, default: false },
    allowMultipleAttempts: { type: Boolean, default: false },
    negativeMarking: { type: Boolean, default: false },
    negativeMarkValue: { type: Number, default: 0, min: 0 },

    // Proctoring: how many warnings a candidate gets for leaving the exam
    // window (minimise / switch tab / switch app) before the exam is
    // auto-submitted on the next violation.
    proctoringEnabled: { type: Boolean, default: true },
    maxWarnings: { type: Number, default: 3, min: 0, max: 10 },

    // Written (short/long) answers are graded by AI right after submission.
    aiEvaluation: { type: Boolean, default: true },
    // Let candidates see their score on the thank-you page once it is ready.
    showResultToCandidate: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['Draft', 'Scheduled', 'Live', 'Paused', 'Completed', 'Archived'],
      default: 'Draft',
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

ExamSchema.index({ status: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.models.Exam || mongoose.model('Exam', ExamSchema);
