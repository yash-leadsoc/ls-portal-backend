const ExamAdmin = require('../../models/exam/ExamAdmin');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Compared against when the account does not exist so response time does not reveal valid IDs.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

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

    // One message for every failure mode (unknown id, inactive, wrong password).
    const valid = admin ? await admin.verifyPassword(password) : (await bcrypt.compare(password, DUMMY_HASH), false);

    if (!admin || !admin.active || !valid) {
      return res.status(401).json({
        message: 'Invalid credentials or inactive account.',
      });
    }

    if (!process.env.EXAM_ADMIN_JWT_SECRET) {
      throw new Error('EXAM_ADMIN_JWT_SECRET is not configured.');
    }

    const token = jwt.sign(
      {
        sub: admin._id.toString(),
        type: 'exam_admin',
        ver: admin.tokenVersion || 0,
      },
      process.env.EXAM_ADMIN_JWT_SECRET,
      { expiresIn: process.env.EXAM_ADMIN_JWT_EXPIRES_IN || '8h', algorithm: 'HS256' }
    );

    await ExamAdmin.updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } });

    res.json({
      token,
      admin: {
        id: admin._id,
        adminId: admin.adminId,
        name: admin.name,
        email: admin.email,
        role: admin.role || 'admin',
      },
    });
  } catch (error) {
    process.stderr.write(`Exam admin login failed: ${error.message}\n`);
    res.status(500).json({ message: 'Exam admin login failed.' });
  }
};

// Secure logout: bumping tokenVersion invalidates every token previously issued to
// this admin (the JWT alone could otherwise be replayed until it expires).
exports.logout = async (req, res) => {
  await ExamAdmin.updateOne({ _id: req.examAdmin._id }, { $inc: { tokenVersion: 1 } });
  res.json({ message: 'Signed out.' });
};
