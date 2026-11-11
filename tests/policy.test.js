const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEventBatch, normalizeConfig, effectiveConfig, sanitizeMeta, MAX_EVENTS_PER_REQUEST } = require('../src/services/exam/proctoringPolicy');
const { validAnswer, parseSeq } = require('../src/services/exam/answerValidation');
const TtlCache = require('../src/utils/ttlCache');
const { redact } = require('../src/utils/logger');

const now = Date.now();
const good = (o = {}) => ({ type: 'TAB_SWITCH', clientEventId: 'ep_12345678', at: now - 1000, ...o });
const run = (events, extra = {}) => validateEventBatch({ events }, { now, attemptCreatedAt: now - 3600e3, config: {}, ...extra });

test('accepts a well-formed event and strips everything a candidate must not set', () => {
  const r = run([good({ durationMs: 2500, confidence: 0.91, severity: 'LOW', review: { status: 'Dismissed' }, candidate: 'x', exam: 'y', attempt: 'z', source: 'admin' })]);
  assert.equal(r.events.length, 1);
  assert.deepEqual(Object.keys(r.events[0]).sort(), ['at', 'clientEventId', 'confidence', 'durationMs', 'type']);
});

test('rejects unknown types, bad ids, bad numbers, out-of-range times', () => {
  const r = run([good({ type: 'ADMIN_OVERRIDE' }), good({ clientEventId: 'short' }), good({ clientEventId: 'ok_id_0001', durationMs: -1 }), good({ clientEventId: 'ok_id_0002', confidence: 2 }), good({ clientEventId: 'ok_id_0003', at: now + 3600e3 }), good({ clientEventId: 'ok_id_0004', at: now - 30 * 86400e3 }), null, 'str']);
  assert.equal(r.events.length, 0); assert.equal(r.rejected, 8);
});

test('optional PHONE/AUDIO events need the feature enabled for the exam', () => {
  assert.equal(run([good({ type: 'PHONE_DETECTED' })]).events.length, 0);
  assert.equal(run([good({ type: 'PHONE_DETECTED' })], { config: { phoneDetection: true } }).events.length, 1);
});

test('batch size and shape are enforced', () => {
  assert.ok(validateEventBatch({ events: 'x' }).error);
  assert.ok(validateEventBatch(null).error);
  const many = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, (_, i) => good({ clientEventId: `ep_${String(i).padStart(8, '0')}` }));
  assert.ok(run(many).error);
});

test('same episode twice in a batch merges, keeping earliest start and longest duration', () => {
  const r = run([good({ at: now - 5000 }), good({ at: now - 4000, durationMs: 4000 })]);
  assert.equal(r.events.length, 1); assert.equal(r.events[0].durationMs, 4000); assert.equal(+r.events[0].at, now - 5000);
});

test('meta is whitelisted, typed and size-limited', () => {
  assert.deepEqual(sanitizeMeta({ direction: 'LEFT', faceCount: 2, evil: '<script>', nested: { a: 1 } }), { direction: 'LEFT', faceCount: 2 });
  assert.equal(sanitizeMeta({ direction: 'SIDEWAYS' }), undefined);
  assert.equal(sanitizeMeta('str'), undefined);
  assert.equal(sanitizeMeta({ key: 'a<b>\u0000'.repeat(40) }).key.length <= 60, true);
});

test('config is clamped; garbage cannot be stored', () => {
  const c = normalizeConfig({ enabled: 'true', detectionFps: 1000, noFaceSeconds: -5, yawThreshold: 'abc', consentVersion: '<v2>!', hack: 1 });
  assert.equal(c.enabled, true); assert.equal(c.detectionFps, 4); assert.equal(c.noFaceSeconds, 3); assert.equal(c.yawThreshold, 0.28); assert.equal(c.consentVersion, 'v2'); assert.equal('hack' in c, false);
  const e = effectiveConfig({}); assert.equal(e.enabled, false); assert.equal(e.detectionFps, 2); assert.equal(e.phoneDetection, false);
});

test('answers are validated by question type', () => {
  const opt = new Set(['A', 'B', 'C']);
  assert.ok(validAnswer({ type: 'MCQ', optionValues: opt }, 'A'));
  assert.ok(!validAnswer({ type: 'MCQ', optionValues: opt }, 'Z'));
  assert.ok(!validAnswer({ type: 'MCQ', optionValues: opt }, ['A']));
  assert.ok(validAnswer({ type: 'MULTI_SELECT', optionValues: opt }, ['A', 'C']));
  assert.ok(!validAnswer({ type: 'MULTI_SELECT', optionValues: opt }, ['A', 'A']));
  assert.ok(!validAnswer({ type: 'MULTI_SELECT', optionValues: opt }, ['A', 'Z']));
  assert.ok(validAnswer({ type: 'TRUE_FALSE', optionValues: new Set() }, 'true'));
  assert.ok(!validAnswer({ type: 'TRUE_FALSE', optionValues: new Set() }, 'maybe'));
  assert.ok(validAnswer({ type: 'MCQ', optionValues: opt }, null)); // clearing is allowed
  assert.ok(!validAnswer({ type: 'SHORT_ANSWER' }, 'x'.repeat(1001)));
  assert.ok(!validAnswer({ type: 'WEIRD' }, 'x'));
  assert.equal(parseSeq(5), 5); assert.equal(parseSeq(-1), null); assert.equal(parseSeq('5'), null); assert.equal(parseSeq(1.5), null);
});

test('TtlCache expires, caps size, and deletes by predicate', () => {
  let t = 0; const c = new TtlCache({ ttlMs: 100, max: 2, now: () => t });
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  assert.equal(c.get('a'), undefined); assert.equal(c.get('b'), 2);
  t = 101; assert.equal(c.get('b'), undefined);
  c.set('x:1', 1); c.set('x:2', 2); c.deleteWhere((k) => k.startsWith('x:')); assert.equal(c.size, 0);
});

test('logger redacts secrets', () => {
  const r = redact({ user: 'a', password: 'p', nested: { authorization: 'Bearer x', ok: 1 }, jwtToken: 't', MONGO_URI: 'm' });
  assert.equal(r.password, '[REDACTED]'); assert.equal(r.nested.authorization, '[REDACTED]'); assert.equal(r.jwtToken, '[REDACTED]'); assert.equal(r.MONGO_URI, '[REDACTED]'); assert.equal(r.user, 'a'); assert.equal(r.nested.ok, 1);
});
