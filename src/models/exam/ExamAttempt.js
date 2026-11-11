const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    attemptId: { type: String, unique: true },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamCandidate', required: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    examSet: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSet', required: true },
    status: {
      type: String,
      enum: ['Registered', 'In Progress', 'Submitted', 'Auto Submitted', 'Under Evaluation', 'Evaluated'],
      default: 'Registered',
    },
    startedAt: Date,
    expiresAt: Date,
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
        // Client-assigned, monotonically increasing per question. A save carrying a
        // lower seq than the stored one is acknowledged but NOT applied, so a
        // delayed/retried request can never overwrite a newer answer.
        // Absent on records created before this field existed (treated as 0).
        seq: Number,
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
    // 'pending' from the moment the submission is claimed until scoring finishes (crash-repair marker).
    scoring: { type: String, enum: ['pending', 'done'] },
    objectiveScore: { type: Number, default: 0 },
    obtainedMarks: { type: Number, default: 0 },
    evaluationPending: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes (all additive; existing single-field indexes in Atlas are left alone).
schema.index({ candidate: 1, exam: 1 });           // candidate -> attempts; also serves { candidate } prefix
schema.index({ exam: 1, status: 1 });              // exam dashboards, live counts, proctoring overview
schema.index({ status: 1, expiresAt: 1 });         // expiry sweeper
schema.index({ scoring: 1 }, { partialFilterExpression: { scoring: 'pending' } }); // tiny: only in-flight scorings
schema.index({ examSet: 1 });                      // set-delete guard (Attempt.exists({ examSet }))

module.exports = mongoose.models.ExamAttempt || mongoose.model('ExamAttempt', schema);
