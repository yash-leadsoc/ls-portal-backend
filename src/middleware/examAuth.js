// const crypto=require('crypto');
// const Attempt=require('../models/exam/ExamAttempt');
// const {requireAuth,requireRole,requireFullAdmin}=require('./auth');
// const requireExamAdmin=[requireAuth,requireRole('admin'),requireFullAdmin];
// async function requireAttempt(req,res,next){
//  try{
//   const token=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
//   if(!token)return res.status(401).json({message:'Attempt token required'});
//   const hash=crypto.createHash('sha256').update(token).digest('hex');
//   const attempt=await Attempt.findOne({attemptId:req.params.attemptId,attemptTokenHash:hash});
//   if(!attempt)return res.status(401).json({message:'Invalid attempt credentials'});
//   req.examAttempt=attempt;next();
//  }catch(e){next(e);}
// }
// module.exports={requireExamAdmin,requireAttempt};


const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const Attempt = require('../models/exam/ExamAttempt');
const ExamAdmin = require('../models/exam/ExamAdmin');

async function requireExamAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.replace(/^Bearer\s+/i, '');

    if (!token) {
      return res.status(401).json({
        message: 'Exam admin authentication required.',
      });
    }

    if (!process.env.EXAM_ADMIN_JWT_SECRET) {
      throw new Error('EXAM_ADMIN_JWT_SECRET is not configured.');
    }

    const decoded = jwt.verify(
      token,
      process.env.EXAM_ADMIN_JWT_SECRET
    );

    if (decoded.type !== 'exam_admin' || !decoded.sub) {
      return res.status(401).json({
        message: 'Invalid Exam Admin token.',
      });
    }

    const admin = await ExamAdmin.findById(decoded.sub);

    if (!admin || !admin.active) {
      return res.status(401).json({
        message: 'Exam Admin account is inactive or unavailable.',
      });
    }

    req.examAdmin = admin;
    next();
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError' ||
      error.name === 'TokenExpiredError'
    ) {
      return res.status(401).json({
        message: 'Invalid or expired Exam Admin session.',
      });
    }

    next(error);
  }
}

async function requireAttempt(req, res, next) {
  try {
    const token = (req.headers.authorization || '')
      .replace(/^Bearer\s+/i, '');

    if (!token) {
      return res.status(401).json({
        message: 'Attempt token required.',
      });
    }

    const hash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const attempt = await Attempt.findOne({
      attemptId: req.params.attemptId,
      attemptTokenHash: hash,
    });

    if (!attempt) {
      return res.status(401).json({
        message: 'Invalid attempt credentials.',
      });
    }

    req.examAttempt = attempt;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireExamAdmin,
  requireAttempt,
};