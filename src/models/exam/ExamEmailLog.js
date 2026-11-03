const mongoose=require('mongoose');
const schema=new mongoose.Schema({attempt:{type:mongoose.Schema.Types.ObjectId,ref:'ExamAttempt'},to:String,subject:String,status:{type:String,enum:['Pending','Sent','Failed'],default:'Pending'},error:String,sentAt:Date},{timestamps:true});
module.exports=mongoose.models.ExamEmailLog||mongoose.model('ExamEmailLog',schema);
