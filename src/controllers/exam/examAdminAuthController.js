const ExamAdmin = require('../../models/exam/ExamAdmin');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body || {};

    if (
      typeof identifier !== 'string' ||
      typeof password !== 'string' ||
      !identifier.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: 'Enter your Exam Admin ID and password.',
      });
    }

    const admin = await ExamAdmin.findOne({
      $or: [
        { adminId: identifier.trim().toUpperCase() },
        { email: identifier.trim().toLowerCase() },
      ],
    });

    if (!admin || !admin.active) {
      return res.status(401).json({
        message: 'Invalid credentials or inactive account.',
      });
    }

    const valid = await admin.verifyPassword(password);

    if (!valid) {
      return res.status(401).json({
        message: 'Invalid credentials.',
      });
    }

    if (!process.env.EXAM_ADMIN_JWT_SECRET) {
      throw new Error('EXAM_ADMIN_JWT_SECRET is not configured.');
    }

    const token = jwt.sign(
      {
        sub: admin._id.toString(),
        type: 'exam_admin',
      },
      process.env.EXAM_ADMIN_JWT_SECRET,
      { expiresIn: '8h' }
    );

    admin.lastLoginAt = new Date();
    await admin.save();

    res.json({
      token,
      admin: {
        id: admin._id,
        adminId: admin.adminId,
        name: admin.name,
        email: admin.email,
      },
    });
  } catch (error) {
    console.error('Exam admin login:', error.message);
    res.status(500).json({ message: 'Exam admin login failed.' });
  }
};