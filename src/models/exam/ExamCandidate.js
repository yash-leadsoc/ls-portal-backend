// const mongoose = require('mongoose');
// const schema = new mongoose.Schema({
//     candidateId: { type: String, unique: true }, name: { type: String, required: true, trim: true },
//     email: { type: String, required: true, lowercase: true, trim: true, index: true },
//     phone: { type: String, required: true }, 
//     interestedDomain: {
//   type: String,
//   required: true,
//   enum: [
//     'Analogy Layout',
//     'Analog Design',
//     'Memory Layout',
//     'Memory Design'
//   ]
// },
//     exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true }
// }, { timestamps: true });
// schema.index({ exam: 1, email: 1 }, { unique: true });
// module.exports = mongoose.models.ExamCandidate || mongoose.model('ExamCandidate', schema);

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  candidateId: {
    type: String,
    unique: true,
    index: true
  },

  name: {
    type: String,
    required: true,
    trim: true
  },

  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },

  phone: {
    type: String,
    required: true
  },

  interestedDomain: {
    type: String,
    required: true,
    enum: [
      'Analogy Layout',
      'Analog Design',
      'Memory Layout',
      'Memory Design'
    ],
    trim: true
  },

  exam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true,
    index: true
  }

}, { timestamps: true });

schema.index({ exam: 1, email: 1 }, { unique: true });

module.exports =
  mongoose.models.ExamCandidate ||
  mongoose.model('ExamCandidate', schema);