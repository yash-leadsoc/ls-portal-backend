const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 exam:{type:mongoose.Schema.Types.ObjectId,ref:'Exam',required:true},
 name:{type:String,required:true},description:String,questions:[{type:mongoose.Schema.Types.ObjectId,ref:'ExamQuestion'}],
 totalMarks:{type:Number,default:0},isActive:{type:Boolean,default:true}
},{timestamps:true});
schema.index({exam:1,name:1},{unique:true});
module.exports=mongoose.models.ExamSet||mongoose.model('ExamSet',schema);
