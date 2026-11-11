const mongoose = require('mongoose');
const { EVENT_TYPES, REVIEW_STATUS } = require('../../services/exam/proctoringPolicy');

/**
 * One document per "episode" (e.g. one period of the face being missing, one tab
 * switch). The browser re-sends the same clientEventId when the episode ends so
 * the duration is filled in by an idempotent upsert: retries and duplicate
 * deliveries can never create duplicate rows.
 *
 * Metadata only. No images, video or audio are ever stored here.
 */
const schema = new mongoose.Schema(
  {
    attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamAttempt', required: true },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamCandidate', required: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    clientEventId: { type: String, required: true },
    type: { type: String, enum: EVENT_TYPES, required: true },
    severity: { type: String, enum: ['INFO', 'LOW', 'MEDIUM'], default: 'LOW' },
    at: { type: Date, required: true }, // when the episode started (client clock, bounded server-side)
    durationMs: Number, // set/extended when the episode ends
    confidence: Number, // 0..1, max seen during the episode (when the detector provides it)
    meta: mongoose.Schema.Types.Mixed, // whitelisted, <=300 bytes (see sanitizeMeta)
    source: { type: String, enum: ['client'], default: 'client' },

    // Reviewer fields – written ONLY by the admin endpoints, never from candidate input.
    review: {
      status: { type: String, enum: REVIEW_STATUS, default: 'Pending' },
      note: { type: String, maxlength: 1000 },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamAdmin' },
      at: Date,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);

schema.index({ attempt: 1, clientEventId: 1 }, { unique: true }); // idempotency
schema.index({ attempt: 1, at: 1 }); // candidate timeline
schema.index({ exam: 1, 'review.status': 1, severity: 1 }); // review queues

const days = Number(process.env.PROCTORING_RETENTION_DAYS ?? 180);
// Retention: events are deleted automatically N days after creation. Set
// PROCTORING_RETENTION_DAYS=0 to disable the TTL index (then delete manually per policy).
if (days > 0) schema.index({ createdAt: 1 }, { expireAfterSeconds: Math.round(days * 86400) });

module.exports = mongoose.models.ExamProctoringEvent || mongoose.model('ExamProctoringEvent', schema);
