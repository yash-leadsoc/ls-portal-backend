const PptSubmission = require('../models/PptSubmission');
const { logAudit } = require('../utils/audit');
exports.submit = async (req, res) => {
  try {
    const {
      domainId,
      exerciseName,
      googleDriveLink,
    } = req.body;

    if (!domainId) {
      return res.status(400).json({
        message: 'Domain ID is required',
      });
    }

    if (!googleDriveLink || !googleDriveLink.trim()) {
      return res.status(400).json({
        message: 'Google Drive link is required',
      });
    }

    if (
      !googleDriveLink.includes('drive.google.com') &&
      !googleDriveLink.includes('docs.google.com')
    ) {
      return res.status(400).json({
        message: 'Please enter a valid Google Drive link',
      });
    }

    const submission = await PptSubmission.findOneAndUpdate(
      {
        domain: domainId,
        uploadedBy: req.user._id,
      },
      {
        googleDriveLink: googleDriveLink.trim(),
        uploadedBy: req.user._id,
        domain: domainId,
        exerciseName: exerciseName || 'PPT Exercise',
      },
      {
        new: true,
        upsert: true,
      }
    );

     await logAudit(req, {
    action: 'submit', entity: 'pptSubmission',
    entityId: submission._id, entityLabel: submission.exerciseName,
  });
    return res.json({
      message: 'PPT submitted successfully',
      submission,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to submit PPT',
    });
  }
};

exports.getEmployeeSubmissions = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const submissions = await PptSubmission.find({
      uploadedBy: employeeId,
    })
      .populate('uploadedBy', 'name email employeeCode')
      .populate('domain', 'name description icon')
      .sort({ createdAt: -1 });

    return res.json({
      submissions,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to load employee PPT submissions',
    });
  }
};
