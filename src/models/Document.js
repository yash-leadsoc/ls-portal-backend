const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    domain: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true },
    businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploaderRole: { type: String, enum: ['admin', 'cto', 'bu', 'manager'], required: true },

    active: { type: Boolean, default: true },
    type: { type: String, enum: ['file', 'youtube', 'html'], default: 'file' },
    sourceUrl: { type: String, default: null },
    htmlContent: { type: String, default: null },

    cloudinaryPublicId: {
      type: String,
      default: null,
    },

    cloudinaryUrl: {
      type: String,
      default: null,
    },

    cloudinaryResourceType: {
      type: String,
      default: 'raw',
    },

    previewPublicId: {
      type: String,
      default: null,
    },

    previewUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

documentSchema.index({ businessUnit: 1, domain: 1, createdAt: -1 });
documentSchema.index({ domain: 1, createdAt: -1 });
module.exports = mongoose.model('Document', documentSchema);
