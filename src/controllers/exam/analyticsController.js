const Exam = require('../../models/exam/Exam');
const Candidate = require('../../models/exam/ExamCandidate');
const Attempt = require('../../models/exam/ExamAttempt');
const Result = require('../../models/exam/ExamResult');

exports.dashboard = async (req, res) => {
  const done = ['Submitted', 'Auto Submitted', 'Under Evaluation', 'Evaluated'];
  const [totalExams, activeExams, scheduledExams, totalCandidates, totalAttempts, completed, appearing, avg, pass, evaluated, pendingEvaluation, autoSubmitted, flagged, recent] =
    await Promise.all([
      Exam.countDocuments(),
      Exam.countDocuments({ status: 'Live' }),
      Exam.countDocuments({ status: 'Scheduled' }),
      Candidate.countDocuments(),
      Attempt.countDocuments(),
      Attempt.countDocuments({ status: { $in: done } }),
      Attempt.countDocuments({ status: 'In Progress' }),
      Result.aggregate([{ $match: { status: { $in: ['Pass', 'Fail'] } } }, { $group: { _id: null, avg: { $avg: '$percentage' } } }]),
      Result.countDocuments({ status: 'Pass' }),
      Result.countDocuments({ status: { $in: ['Pass', 'Fail'] } }),
      Result.countDocuments({ status: 'Pending Evaluation' }),
      Attempt.countDocuments({ autoSubmitted: true, autoSubmitReason: 'PROCTORING_VIOLATIONS' }),
      Attempt.countDocuments({ violationCount: { $gt: 0 } }),
      Result.find().sort({ createdAt: -1 }).limit(6).populate('candidate', 'name candidateId').populate('exam', 'name').populate('attempt', 'violationCount autoSubmitted').lean(),
    ]);
  res.json({
    totalExams, activeExams, scheduledExams, totalCandidates, totalAttempts, completed, appearing,
    averageScore: avg[0]?.avg || 0,
    passPercentage: evaluated ? (pass / evaluated) * 100 : 0,
    pendingEvaluation, autoSubmitted, flagged, recent,
  });
};
