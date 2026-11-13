// // const nodemailer=require('nodemailer');
// // const EmailLog=require('../../models/exam/ExamEmailLog');
// // exports.sendSubmissionEmail=async(attempt,candidate)=>{
// //  const log=await EmailLog.create({attempt:attempt._id,to:candidate.email,subject:'Thank You for Completing the LeadSoc Examination',status:'Pending'});
// //  try{
// //   const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
// //   await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:candidate.email,subject:log.subject,text:`Dear ${candidate.name},\n\nThank you for participating in the LeadSoc examination.\n\nYour examination has been successfully submitted.\n\nYour Candidate ID: ${candidate.candidateId}\n\nOur team will evaluate your performance and get back to you with further updates.\n\nRegards,\nLeadSoc Technologies`});
// //   log.status='Sent';log.sentAt=new Date();await log.save();
// //  }catch(e){log.status='Failed';log.error=e.message;await log.save();}
// //  return log;
// // };

// // const EmailLog = require('../../models/exam/ExamEmailLog');
// // const { senderFor, openSender } = require('../../services/mailer');

// // exports.sendSubmissionEmail = async (attempt, candidate) => {
// //   const subject = 'Thank You for Completing the LeadSoc Examination';

// //   const log = await EmailLog.create({
// //     attempt: attempt._id,
// //     to: candidate.email,
// //     subject,
// //     status: 'Pending'
// //   });

// //   try {
// //     const smtp = await senderFor(null);

// //     if (smtp.error) {
// //       throw new Error(smtp.error);
// //     }

// //     const mailer = openSender(smtp);

// //     try {
// //       await mailer.send({
// //         fromName: 'LeadSoc Technologies',
// //         to: candidate.email,
// //         toName: candidate.name,
// //         subject,
// //         text: `Dear ${candidate.name},

// // Thank you for participating in the LeadSoc examination.

// // Your examination has been successfully submitted.

// // Your Candidate ID: ${candidate.candidateId}

// // Our team will evaluate your performance and get back to you with further updates.

// // Regards,
// // LeadSoc Technologies`
// //       });
// //     } finally {
// //       mailer.close();
// //     }

// //     log.status = 'Sent';
// //     log.sentAt = new Date();
// //     await log.save();

// //   } catch (error) {
// //     console.error('Exam submission email error:', error);

// //     log.status = 'Failed';
// //     log.error = error.message;
// //     await log.save();
// //   }

// //   return log;
// // };


// const EmailLog = require('../../models/exam/ExamEmailLog');
// const { systemSender, openSender } = require('../mailer');

// exports.sendSubmissionEmail = async (attempt, candidate) => {
//   const subject = 'Thank You for Completing the LeadSoc Examination';

//   const log = await EmailLog.create({
//     attempt: attempt._id,
//     to: candidate.email,
//     subject,
//     status: 'Pending'
//   });

//   let mailer;

//   try {
//     // Get configured system mailbox
//     const smtp = await systemSender();

//     if (smtp.error) {
//       throw new Error(smtp.error);
//     }

//     mailer = openSender(smtp);

//     await mailer.send({
//       fromName: 'LeadSoc Technologies',
//       to: candidate.email,
//       toName: candidate.name,
//       subject,

//       text: `Dear ${candidate.name},

// Thank you for participating in the LeadSoc examination.

// Your examination has been successfully submitted.

// Your Candidate ID: ${candidate.candidateId}

// Our team will evaluate your performance and get back to you with further updates.

// Regards,
// LeadSoc Technologies`
//     });

//     log.status = 'Sent';
//     log.sentAt = new Date();
//     log.error = null;

//     await log.save();

//     console.log(`Exam email sent successfully to ${candidate.email}`);

//   } catch (error) {
//     console.error('Exam submission email error:', error.message);

//     log.status = 'Failed';
//     log.error = error.message;

//     await log.save();

//   } finally {
//     if (mailer) {
//       mailer.close();
//     }
//   }

//   return log;
// };


const EmailLog = require('../../models/exam/ExamEmailLog');
const Exam = require('../../models/exam/Exam');
const { systemSender, openSender } = require('../mailer');
const { emailLayout, esc } = require('../../utils/emailTemplate');

function fmtDate(d) {
  try {
    return new Date(d || Date.now()).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) + ' IST';
  } catch (e) {
    return '';
  }
}

function row(label, value) {
  return `
    <tr>
      <td style="padding:8px 12px;font-size:13px;color:#64748b;border-bottom:1px solid #eef1f6;width:40%;">${esc(label)}</td>
      <td style="padding:8px 12px;font-size:13px;color:#1f2937;font-weight:600;border-bottom:1px solid #eef1f6;">${esc(value)}</td>
    </tr>`;
}

function buildSubmissionEmail({ candidate, examName, submittedAt, autoSubmitted }) {
  const subject = 'Thank You for Completing the LeadSoc Examination';

  const autoNote = autoSubmitted
    ? `<p style="margin:0 0 16px;padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:13px;color:#9a3412;">
         Your examination was submitted automatically (time expired or the exam rules were triggered). Your answers up to that point have been saved.
       </p>`
    : '';

  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:16px;color:#1b2b5e;font-weight:700;">Dear ${esc(candidate.name)},</p>

    <p style="margin:0 0 14px;">
      Thank you for participating in the LeadSoc examination.
      Your examination has been <strong>successfully submitted</strong>.
    </p>

    ${autoNote}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:0 0 18px;border:1px solid #e5e9f2;border-radius:8px;border-collapse:separate;background:#f8fafc;">
      ${row('Candidate ID', candidate.candidateId || '-')}
      ${examName ? row('Examination', examName) : ''}
      ${row('Submitted on', fmtDate(submittedAt))}
    </table>

    <p style="margin:0 0 14px;">
      Please keep your Candidate ID for future reference. Our team will evaluate your
      performance and get back to you with further updates.
    </p>

    <p style="margin:0 0 6px;">Regards,</p>
    <p style="margin:0 0 18px;font-weight:700;color:#1b2b5e;">LeadSoc Technologies</p>
  `;

  const html = emailLayout({
    bodyHtml,
    preheader: 'Your LeadSoc examination has been submitted successfully.',
    footerHtml: 'This is an automated message. Please do not reply to this email.',
  });

  const text = `Dear ${candidate.name},

Thank you for participating in the LeadSoc examination.

Your examination has been successfully submitted.
${autoSubmitted ? '\nNote: Your examination was submitted automatically. Your answers up to that point have been saved.\n' : ''}
Candidate ID: ${candidate.candidateId || '-'}
${examName ? `Examination: ${examName}\n` : ''}Submitted on: ${fmtDate(submittedAt)}

Our team will evaluate your performance and get back to you with further updates.

Regards,
LeadSoc Technologies`;

  return { subject, html, text };
}

exports.buildSubmissionEmail = buildSubmissionEmail;

exports.sendSubmissionEmail = async (attempt, candidate) => {
  const subject = 'Thank You for Completing the LeadSoc Examination';

  const log = await EmailLog.create({
    attempt: attempt._id,
    to: candidate.email,
    subject,
    status: 'Pending',
  });

  let mailer;

  try {
    const smtp = await systemSender();
    if (smtp.error) throw new Error(smtp.error);

    let examName = '';
    try {
      const exam = await Exam.findById(attempt.exam).select('name').lean();
      examName = exam?.name || '';
    } catch (e) {}

    const mail = buildSubmissionEmail({
      candidate,
      examName,
      submittedAt: attempt.submittedAt,
      autoSubmitted: attempt.status === 'Auto Submitted' || attempt.autoSubmitted === true,
    });

    mailer = openSender(smtp);

    await mailer.send({
      fromName: 'LeadSoc Technologies',
      to: candidate.email,
      toName: candidate.name,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    log.status = 'Sent';
    log.sentAt = new Date();
    log.error = null;
    await log.save();

    console.log(`Exam submission email sent to ${candidate.email}`);
  } catch (error) {
    console.error('Exam submission email error:', error.message);
    log.status = 'Failed';
    log.error = error.message;
    await log.save();
  } finally {
    if (mailer) mailer.close();
  }

  return log;
};