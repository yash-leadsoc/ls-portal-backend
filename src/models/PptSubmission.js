const mongoose = require('mongoose');

const pptSubmissionSchema = new mongoose.Schema(
  {
    googleDriveLink: {
      type: String,
      trim: true,
      default: null,
    },

    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    domain: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Domain',
      required: true,
    },

     exercise: {
      type: String,
      trim: true,
      default: 'PPT Exercise',
    },
  },
  {
    timestamps: true,
  }
);

pptSubmissionSchema.index({ uploadedBy: 1 });
module.exports = mongoose.model('PptSubmission', pptSubmissionSchema);
