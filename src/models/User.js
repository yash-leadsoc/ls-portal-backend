const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['admin', 'cto', 'bu', 'manager', 'employee'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    employeeCode: { type: String, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },

    assignedDomains: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Domain',
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    businessUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    active: { type: Boolean, default: true },
    enrolledAt: { type: Date, default: Date.now },

    preferredLocation: { type: String, default: '' },
    skills: { type: [String], default: [] },
    contactNumber: { type: String, default: '' },
    benchStart: { type: Date, default: null },
    jobStatus: { type: String, enum: ['on_training', 'ongoing_interview', 'deployed'], default: 'on_training' },

    menuConfig: { type: [String], default: [] },

    lastLoginAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: null },

    streak: {
      current: { type: Number, default: 0 },
      longest: { type: Number, default: 0 },
      lastActiveDate: { type: String, default: null },
      activeDays: { type: [String], default: [] },
    },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 10);
};

userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    employeeCode: this.employeeCode,
    role: this.role,
    createdBy: this.createdBy,
    manager: this.manager,
    category: this.category,
    businessUnit: this.businessUnit,
    active: this.active,
    assignedDomains: this.assignedDomains || [],
    enrolledAt: this.enrolledAt,
    preferredLocation: this.preferredLocation || '',
    skills: this.skills || [],
    contactNumber: this.contactNumber || '',
    benchStart: this.benchStart,
    jobStatus: this.jobStatus || 'on_training',
    menuConfig: this.menuConfig || [],
    streak: this.streak || { current: 0, longest: 0, lastActiveDate: null, activeDays: [] },
    lastLoginAt: this.lastLoginAt,
    lastActiveAt: this.lastActiveAt,
    createdAt: this.createdAt,
  };
};

userSchema.statics.ROLES = ROLES;

userSchema.index({ role: 1, businessUnit: 1 });
userSchema.index({ businessUnit: 1 });
userSchema.index({ manager: 1 });
userSchema.index({ employeeCode: 1 });
module.exports = mongoose.model('User', userSchema);
