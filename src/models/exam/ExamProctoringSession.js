const mongoose = require('mongoose');
const { CASE_STATUS } = require('../../services/exam/proctoringPolicy');

/**
 * NOTE: rows are created by upsert (setDefaultsOnInsert:false), so every reader treats a
 * missing field as its default (review 'Clear', camera 'unknown', accommodation 'None').
 *
 * One document per attempt: consent record, camera status, accommodation request
 * and running counters. Kept OUT of ExamAttempt on purpose so proctoring writes
 * never contend with answer-saving writes on the same document.
 */
const schema = new mongoose.Schema(
  {
    attempt: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamAttempt', required: true },
    candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamCandidate', required: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },

    consent: {
      given: { type: Boolean, default: false },
      version: String,
      at: Date,
    },
    camera: {
      // Reported by the candidate's browser (attestation, not proof).
      state: { type: String, enum: ['unknown', 'ok', 'denied', 'unavailable', 'disconnected', 'not_required'], default: 'unknown' },
      precheckPassedAt: Date,
      updatedAt: Date,
    },
    accommodation: {
      status: { type: String, enum: ['None', 'Pending', 'Approved', 'Denied'], default: 'None' },
      reason: { type: String, maxlength: 500 },
      requestedAt: Date,
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamAdmin' },
      decidedAt: Date,
      decisionNote: { type: String, maxlength: 500 },
    },

    // Written via atomic $inc by the ingestion endpoint; no schema default on purpose
    // (a default {} would collide with $inc 'counts.X' on upsert). Missing = no events.
    counts: { type: mongoose.Schema.Types.Mixed }, // { TAB_SWITCH: 2, ... }
    eventTotal: { type: Number, default: 0 },
    lastEventAt: Date,

    review: {
      status: { type: String, enum: CASE_STATUS, default: 'Clear' },
      note: { type: String, maxlength: 1000 },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamAdmin' },
      at: Date,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, timestamps: false }
);

schema.index({ attempt: 1 }, { unique: true });
schema.index({ exam: 1, 'review.status': 1 });
schema.index({ exam: 1, 'accommodation.status': 1 });

const days = Number(process.env.PROCTORING_RETENTION_DAYS ?? 180);
if (days > 0) schema.index({ createdAt: 1 }, { expireAfterSeconds: Math.round(days * 86400) });

module.exports = mongoose.models.ExamProctoringSession || mongoose.model('ExamProctoringSession', schema);
