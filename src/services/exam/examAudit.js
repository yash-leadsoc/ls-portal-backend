const Log=require('../../models/exam/ExamAuditLog');
module.exports=async function audit(req,action,exam=null,metadata={}) {
 try{return await Log.create({actor:req.examAdmin?._id||req.user?._id,action,exam,metadata,ipAddress:req.ip});}catch(e){console.error('Exam audit failed',e.message);}
};
