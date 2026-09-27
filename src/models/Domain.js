const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    icon: { type: String, default: '📘' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Domain', domainSchema);
