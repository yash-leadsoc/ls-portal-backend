const EmailLog = require('../../models/exam/ExamEmailLog');
const { systemSender, openSender } = require('../../services/mailer');

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

    console.log(`Exam submission email sent to ${candidate.email}`);

  } catch (error) {
    console.error('Exam email error:', error.message);

    log.status = 'Failed';
    log.error = error.message;

    await log.save();

  } finally {
    if (mailer) mailer.close();
  }

  return log;
};