const mongoose=require('mongoose');
const schema=new mongoose.Schema({actor:{type:mongoose.Schema.Types.ObjectId,ref:'User'},action:{type:String,required:true},exam:{type:mongoose.Schema.Types.ObjectId,ref:'Exam'},attempt:{type:mongoose.Schema.Types.ObjectId,ref:'ExamAttempt'},metadata:mongoose.Schema.Types.Mixed,ipAddress:String},{timestamps:true});
schema.index({exam:1,createdAt:-1});
module.exports=mongoose.models.ExamAuditLog||mongoose.model('ExamAuditLog',schema);
