const mongoose = require('mongoose');
const submissionSchema = new mongoose.Schema({
  exercise: { type: mongoose.Schema.Types.ObjectId, ref: 'Exercise', required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  completed: { type: Boolean, default: false },
  driveLink: { type: String, default: '' },
  submittedAt: { type: Date, default: null },
}, { timestamps: true });
submissionSchema.index({ exercise: 1, employee: 1 }, { unique: true });
submissionSchema.index({ employee: 1 });
module.exports = mongoose.model('ExerciseSubmission', submissionSchema);
