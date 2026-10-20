const mongoose = require('mongoose');

const snapshotSchema = new mongoose.Schema(
  {
    weekKey: { type: String, required: true, unique: true },
    rows: [
      {
        _id: false,
        employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        domain: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain' },
        pct: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProgressSnapshot', snapshotSchema);
