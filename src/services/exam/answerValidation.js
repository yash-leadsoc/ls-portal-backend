const MAX_TEXT = 10000;
const MAX_SHORT = 1000;

const isEmpty = (a) => a === null || a === undefined || a === '';

/**
 * Validates an answer against a question's *type and option values only*
 * (never the answer key). `q` = { type, optionValues: Set<string> }.
 * Clearing an answer (null / undefined / '') is always allowed.
 */
function validAnswer(q, answer) {
  if (isEmpty(answer)) return true;
  switch (q.type) {
    case 'MCQ':
      return typeof answer === 'string' && q.optionValues.has(answer);
    case 'TRUE_FALSE':
      return answer === 'true' || answer === 'false';
    case 'MULTI_SELECT':
      return (
        Array.isArray(answer) &&
        answer.length <= 26 &&
        new Set(answer).size === answer.length &&
        answer.every((v) => typeof v === 'string' && q.optionValues.has(v))
      );
    case 'SHORT_ANSWER':
      return typeof answer === 'string' && answer.length <= MAX_SHORT;
    case 'LONG_ANSWER':
      return typeof answer === 'string' && answer.length <= MAX_TEXT;
    default:
      return false;
  }
}

/** A seq is a positive safe integer chosen by the client; anything else means "legacy client". */
function parseSeq(seq) {
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
}

module.exports = { validAnswer, parseSeq, MAX_TEXT, MAX_SHORT };
