const mongoose = require('mongoose');

const mailAccountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    smtpUser: { type: String, required: true, trim: true },
    passEnc: { type: String, required: true },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MailAccount', mailAccountSchema);
