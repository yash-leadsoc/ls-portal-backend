const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const schema = new mongoose.Schema({
  adminId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  lastLoginAt: Date,
}, { timestamps: true });

schema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

module.exports =
  mongoose.models.ExamAdmin ||
  mongoose.model('ExamAdmin', schema);