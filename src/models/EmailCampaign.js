const mongoose = require('mongoose');

const emailCampaignSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true },
    body: { type: String, required: true },
    isHtml: { type: Boolean, default: false },
    audience: { type: String, default: 'custom' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderName: { type: String, default: '' },
    senderEmail: { type: String, default: '' },
    transport: { type: String, default: '' },
    status: { type: String, enum: ['queued', 'sending', 'done', 'failed', 'interrupted'], default: 'queued' },
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    recipients: [
      {
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: String,
        email: String,
        status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
        error: String,
      },
    ],
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

emailCampaignSchema.index({ createdAt: -1 });

module.exports = mongoose.model('EmailCampaign', emailCampaignSchema);
