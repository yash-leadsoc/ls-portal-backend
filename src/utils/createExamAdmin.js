require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const ExamAdmin = require('../models/exam/ExamAdmin');

async function createAdmin() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is missing from .env');
    }

    const { EXAM_ADMIN_ID, EXAM_ADMIN_NAME, EXAM_ADMIN_EMAIL,
      EXAM_ADMIN_PASSWORD } = process.env;

    if (
      !EXAM_ADMIN_ID ||
      !EXAM_ADMIN_NAME ||
      !EXAM_ADMIN_EMAIL ||
      !EXAM_ADMIN_PASSWORD
    ) {
      throw new Error('Set all EXAM_ADMIN_* account variables in .env');
    }

    // if (EXAM_ADMIN_PASSWORD.length < 12) {
    //   throw new Error('Use an Exam Admin password of at least 12 characters.');
    // }

    if (!process.env.EXAM_ADMIN_JWT_SECRET ||
        process.env.EXAM_ADMIN_JWT_SECRET.length < 32) {
      throw new Error('Configure a separate JWT secret of at least 32 characters.');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const adminId = EXAM_ADMIN_ID.trim().toUpperCase();
    const email = EXAM_ADMIN_EMAIL.trim().toLowerCase();

    const existing = await ExamAdmin.findOne({
      $or: [{ adminId }, { email }],
    });

    if (existing) {
      console.log('Exam Admin already exists. No changes made.');
      return;
    }

    const passwordHash = await bcrypt.hash(EXAM_ADMIN_PASSWORD, 12);

    await ExamAdmin.create({
      adminId,
      name: EXAM_ADMIN_NAME.trim(),
      email,
      passwordHash,
      active: true,
    });

    console.log(`Exam Admin created: ${adminId}`);
  } catch (error) {
    console.error('Exam Admin creation failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

createAdmin();