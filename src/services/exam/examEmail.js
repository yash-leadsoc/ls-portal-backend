// const nodemailer=require('nodemailer');
// const EmailLog=require('../../models/exam/ExamEmailLog');
// exports.sendSubmissionEmail=async(attempt,candidate)=>{
//  const log=await EmailLog.create({attempt:attempt._id,to:candidate.email,subject:'Thank You for Completing the LeadSoc Examination',status:'Pending'});
//  try{
//   const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
//   await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:candidate.email,subject:log.subject,text:`Dear ${candidate.name},\n\nThank you for participating in the LeadSoc examination.\n\nYour examination has been successfully submitted.\n\nYour Candidate ID: ${candidate.candidateId}\n\nOur team will evaluate your performance and get back to you with further updates.\n\nRegards,\nLeadSoc Technologies`});
//   log.status='Sent';log.sentAt=new Date();await log.save();
//  }catch(e){log.status='Failed';log.error=e.message;await log.save();}
//  return log;
// };

// const EmailLog = require('../../models/exam/ExamEmailLog');
// const { senderFor, openSender } = require('../../services/mailer');

// exports.sendSubmissionEmail = async (attempt, candidate) => {
//   const subject = 'Thank You for Completing the LeadSoc Examination';

//   const log = await EmailLog.create({
//     attempt: attempt._id,
//     to: candidate.email,
//     subject,
//     status: 'Pending'
//   });

//   try {
//     const smtp = await senderFor(null);

//     if (smtp.error) {
//       throw new Error(smtp.error);
//     }

//     const mailer = openSender(smtp);

//     try {
//       await mailer.send({
//         fromName: 'LeadSoc Technologies',
//         to: candidate.email,
//         toName: candidate.name,
//         subject,
//         text: `Dear ${candidate.name},

// Thank you for participating in the LeadSoc examination.

// Your examination has been successfully submitted.

// Your Candidate ID: ${candidate.candidateId}

// Our team will evaluate your performance and get back to you with further updates.

// Regards,
// LeadSoc Technologies`
//       });
//     } finally {
//       mailer.close();
//     }

//     log.status = 'Sent';
//     log.sentAt = new Date();
//     await log.save();

//   } catch (error) {
//     console.error('Exam submission email error:', error);

//     log.status = 'Failed';
//     log.error = error.message;
//     await log.save();
//   }

//   return log;
// };


const EmailLog = require('../../models/exam/ExamEmailLog');
const { systemSender, openSender } = require('../mailer');

exports.sendSubmissionEmail = async (attempt, candidate) => {
  const subject = 'Thank You for Completing the LeadSoc Examination';

  const log = await EmailLog.create({
    attempt: attempt._id,
    to: candidate.email,
    subject,
    status: 'Pending'
  });

  let mailer;

  try {
    // Get configured system mailbox
    const smtp = await systemSender();

    if (smtp.error) {
      throw new Error(smtp.error);
    }

    mailer = openSender(smtp);

    await mailer.send({
      fromName: 'LeadSoc Technologies',
      to: candidate.email,
      toName: candidate.name,
      subject,

      text: `Dear ${candidate.name},

Thank you for participating in the LeadSoc examination.

Your examination has been successfully submitted.

Your Candidate ID: ${candidate.candidateId}

Our team will evaluate your performance and get back to you with further updates.

Regards,
LeadSoc Technologies`
    });

    log.status = 'Sent';
    log.sentAt = new Date();
    log.error = null;

    await log.save();

    console.log(`Exam email sent successfully to ${candidate.email}`);

  } catch (error) {
    console.error('Exam submission email error:', error.message);

    log.status = 'Failed';
    log.error = error.message;

    await log.save();

  } finally {
    if (mailer) {
      mailer.close();
    }
  }

  return log;
};