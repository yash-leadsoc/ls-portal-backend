const mongoose = require('mongoose');

const experienceSchema = new mongoose.Schema(
  {
    company: String,
    role: String,
    location: String,
    start: String,
    end: String,
    current: { type: Boolean, default: false },
    bullets: [String],
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  { title: String, role: String, tech: String, link: String, bullets: [String] },
  { _id: false }
);

const educationSchema = new mongoose.Schema(
  { degree: String, institution: String, location: String, year: String, score: String },
  { _id: false }
);

const certificationSchema = new mongoose.Schema(
  { name: String, issuer: String, year: String, link: String },
  { _id: false }
);

const resumeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    fullName: { type: String, default: '' },
    headline: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    location: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    github: { type: String, default: '' },
    portfolio: { type: String, default: '' },
    totalExperience: { type: String, default: '' },
    summary: { type: String, default: '' },
    technicalSkills: [String],
    tools: [String],
    softSkills: [String],
    experience: [experienceSchema],
    projects: [projectSchema],
    education: [educationSchema],
    certifications: [certificationSchema],
    achievements: [String],
    languages: [String],
    file: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
      name: { type: String, default: '' },
      uploadedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Resume', resumeSchema);
