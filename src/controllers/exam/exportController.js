const { csv } = require('../../services/exam/examExport');
const { candidateRows } = require('./candidateController');
const { resultRows } = require('./resultController');

const fmt = (d) => (d ? new Date(d).toISOString() : '');

exports.candidates = async (req, res) => {
  const rows = await candidateRows(req.query);
 const headers = [
  'candidateId',
  'name',
  'email',
  'phone',
  'interestedDomain',
  'exam',
  'registered',
  'attemptStatus',
  'marks',
  'violations'
];
  const data = rows.map((x) => ({
    candidateId: x.candidateId, name: x.name, email: x.email, phone: x.phone, exam: x.exam?.name,
    registered: fmt(x.createdAt), attemptStatus: x.attempt?.status || '', interestedDomain: x.interestedDomain || '', marks: x.result?.obtainedMarks ?? '',
    violations: x.attempt?.violationCount ?? '',
  }));
  res.type('text/csv').attachment('exam-candidates.csv').send(csv(data, headers));
};

exports.results = async (req, res) => {
  const rows = await resultRows(req.query);
  const headers = ['rank', 'candidateId', 'name', 'email',  'phone',
    'interestedDomain', 'exam', 'marks', 'maximumMarks', 'percentage', 'status', 'violations', 'autoSubmitted', 'submittedAt'];
  const data = rows.map((x) => ({
    rank: x.rank ?? '', candidateId: x.candidate?.candidateId, name: x.candidate?.name, email: x.candidate?.email,
     phone: x.candidate?.phone || '',
    interestedDomain: x.candidate?.interestedDomain || 'Not selected',
    exam: x.exam?.name, marks: x.obtainedMarks, maximumMarks: x.maximumMarks, percentage: Number(x.percentage || 0).toFixed(2),
    status: x.status, violations: x.attempt?.violationCount ?? 0,
    autoSubmitted: x.attempt?.autoSubmitted ? (x.attempt.autoSubmitReason || 'yes') : 'no', submittedAt: fmt(x.attempt?.submittedAt),
  }));
  res.type('text/csv').attachment('exam-results.csv').send(csv(data, headers));
};
