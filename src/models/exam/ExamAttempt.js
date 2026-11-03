const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    attemptId: { type: String, unique: true, index: true },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamCandidate', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    examSet: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSet', required: true },
    status: {
      type: String,
      enum: ['Registered', 'In Progress', 'Submitted', 'Auto Submitted', 'Under Evaluation', 'Evaluated'],
      default: 'Registered',
      index: true,
    },
    startedAt: Date,
    expiresAt: { type: Date, index: true },
    submittedAt: Date,
    autoSubmitted: { type: Boolean, default: false },
    // 'TIME_EXPIRED' | 'PROCTORING_VIOLATIONS'
    autoSubmitReason: String,

    responses: [
      {
        question: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamQuestion' },
        answer: mongoose.Schema.Types.Mixed,
        markedForReview: { type: Boolean, default: false },
        savedAt: Date,
        _id: false,
      },
    ],

    // Manual evaluation of descriptive answers
    evaluations: [
      {
        question: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamQuestion' },
        marks: Number,
        comment: String,
        source: { type: String, enum: ['AI', 'Manual'], default: 'Manual' },
        confidence: { type: String, enum: ['low', 'medium', 'high'] },
        evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        evaluatedAt: Date,
        _id: false,
      },
    ],

    // Progress of the automatic (AI) grading of written answers
    aiEvaluation: {
      status: { type: String, enum: ['none', 'pending', 'running', 'done', 'failed', 'skipped'], default: 'none' },
      attempts: { type: Number, default: 0 },
      startedAt: Date,
      finishedAt: Date,
      lastError: String,
    },

    attemptTokenHash: { type: String, select: false },
    refreshCount: { type: Number, default: 0 },
    lastHeartbeat: Date,

    // Proctoring
    violationCount: { type: Number, default: 0 },
    violations: [
      {
        kind: { type: String, enum: ['TAB_HIDDEN', 'WINDOW_BLUR', 'OTHER'], default: 'OTHER' },
        at: Date,
        detail: String,
        _id: false,
      },
    ],
    suspiciousActivities: [mongoose.Schema.Types.Mixed],

    ipAddress: String,
    userAgent: String,
    objectiveScore: { type: Number, default: 0 },
    obtainedMarks: { type: Number, default: 0 },
    evaluationPending: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schema.index({ candidate: 1, exam: 1 });
schema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.models.ExamAttempt || mongoose.model('ExamAttempt', schema);
