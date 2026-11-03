const crypto=require('crypto');
const Attempt=require('../models/exam/ExamAttempt');
const {requireAuth,requireRole,requireFullAdmin}=require('./auth');
const requireExamAdmin=[requireAuth,requireRole('admin'),requireFullAdmin];
async function requireAttempt(req,res,next){
 try{
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  if(!token)return res.status(401).json({message:'Attempt token required'});
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  const attempt=await Attempt.findOne({attemptId:req.params.attemptId,attemptTokenHash:hash});
  if(!attempt)return res.status(401).json({message:'Invalid attempt credentials'});
  req.examAttempt=attempt;next();
 }catch(e){next(e);}
}
module.exports={requireExamAdmin,requireAttempt};
