const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 attempt:{type:mongoose.Schema.Types.ObjectId,ref:'ExamAttempt',required:true,unique:true},
 candidate:{type:mongoose.Schema.Types.ObjectId,ref:'ExamCandidate',required:true,index:true},
 exam:{type:mongoose.Schema.Types.ObjectId,ref:'Exam',required:true,index:true},
 maximumMarks:Number,obtainedMarks:{type:Number,default:0},percentage:{type:Number,default:0},
 correctAnswers:{type:Number,default:0},incorrectAnswers:{type:Number,default:0},unanswered:{type:Number,default:0},
 status:{type:String,enum:['Pass','Fail','Pending Evaluation'],default:'Pending Evaluation',index:true},rank:Number
},{timestamps:true});
module.exports=mongoose.models.ExamResult||mongoose.model('ExamResult',schema);
