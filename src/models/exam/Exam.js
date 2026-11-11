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

    // AI-assisted proctoring (browser-side face/pose analysis + browser activity
    // review events). OFF by default so existing exams behave exactly as before.
    // Values are clamped by services/exam/proctoringPolicy.normalizeConfig on write.
    aiProctoring: {
      enabled: { type: Boolean, default: false },
      cameraRequired: { type: Boolean, default: true },
      consentVersion: { type: String, default: 'v1', maxlength: 20 },
      requireFullscreen: { type: Boolean, default: false },
      blockPaste: { type: Boolean, default: false },
      detectionFps: { type: Number, default: 2 },
      poseFps: { type: Number, default: 1 },
      noFaceSeconds: { type: Number, default: 8 },
      multiFaceSeconds: { type: Number, default: 3 },
      headAwaySeconds: { type: Number, default: 6 },
      yawThreshold: { type: Number, default: 0.28 },
      pitchThreshold: { type: Number, default: 0.2 },
      eventCooldownSeconds: { type: Number, default: 30 },
      batchIntervalSeconds: { type: Number, default: 15 },
      // Reserved extension points; accepted only when explicitly enabled and the
      // client build ships the corresponding module (not shipped in this release).
      phoneDetection: { type: Boolean, default: false },
      audioMonitoring: { type: Boolean, default: false },
    },

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
