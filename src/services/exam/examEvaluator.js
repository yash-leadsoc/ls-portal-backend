const norm = (v) => String(v);

exports.hasAnswer = (a) =>
  a != null && a !== '' && (!Array.isArray(a) || a.length > 0) && (typeof a !== 'string' || a.trim() !== '');

// Returns { correct, marks }. Wrong answers lose marks only if the question
// has negativeMarks, or the exam has negative marking enabled.
exports.evaluateObjective = (question, answer, exam = {}) => {
  const expected = [...new Set((question.correctAnswers || []).map(norm))].sort();
  const actual = [
    ...new Set((Array.isArray(answer) ? answer : [answer]).filter((v) => v != null && v !== '').map(norm)),
  ].sort();
  const correct = expected.length > 0 && expected.length === actual.length && expected.every((v, i) => v === actual[i]);
  let penalty = 0;
  if (!correct && actual.length) {
    penalty = question.negativeMarks > 0 ? question.negativeMarks : exam.negativeMarking ? exam.negativeMarkValue || 0 : 0;
  }
  return { correct, marks: correct ? question.marks : -penalty };
};
