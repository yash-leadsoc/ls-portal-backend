const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, required: true },
    answer: { type: String, default: '' },
  },
  { _id: false }
);

const writeupAnswerSchema = new mongoose.Schema(
  {
    writeup: { type: mongoose.Schema.Types.ObjectId, ref: 'Writeup', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    answers: [answerSchema],
  },
  { timestamps: true }
);

writeupAnswerSchema.index({ writeup: 1, employee: 1 }, { unique: true });

writeupAnswerSchema.index({ employee: 1 });
module.exports = mongoose.model('WriteupAnswer', writeupAnswerSchema);
