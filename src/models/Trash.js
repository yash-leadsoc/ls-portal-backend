const mongoose = require('mongoose');

const RETENTION_DAYS = 30;

const trashSchema = new mongoose.Schema(
  {
    entity: { type: String, required: true },
    label: { type: String, default: '' },
    mode: { type: String, enum: ['hard', 'archive'], required: true },
    items: [
      {
        _id: false,
        model: { type: String, required: true },
        doc: { type: mongoose.Schema.Types.Mixed, required: true },
      },
    ],
    refs: [
      {
        _id: false,
        model: { type: String, required: true },
        id: { type: mongoose.Schema.Types.ObjectId, required: true },
      },
    ],
    files: [
      {
        _id: false,
        publicId: String,
        resourceType: String,
        localPath: String,
      },
    ],
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedByName: { type: String, default: '' },
    deletedByRole: { type: String, default: '' },
    businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true, minimize: false }
);

trashSchema.index({ expiresAt: 1 });
trashSchema.index({ createdAt: -1 });

trashSchema.statics.RETENTION_DAYS = RETENTION_DAYS;

module.exports = mongoose.model('Trash', trashSchema);