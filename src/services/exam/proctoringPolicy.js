/**
 * AI-proctoring policy: event vocabulary, severity, config clamping and strict
 * validation of everything a candidate's browser is allowed to send.
 *
 * Pure functions only (no DB, no Express) so they can be unit-tested and so the
 * server never trusts a browser-supplied value without passing through here.
 *
 * IMPORTANT: every event produced under this module is a REVIEW INDICATOR.
 * Nothing in here (or anywhere in the proctoring pipeline) ends an exam.
 */

const EVENT_TYPES = Object.freeze([
  'TAB_SWITCH',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
  'COPY_ATTEMPT',
  'CUT_ATTEMPT',
  'PASTE_ATTEMPT',
  'RESTRICTED_SHORTCUT',
  'CONTEXT_MENU',
  'FACE_NOT_DETECTED',
  'MULTIPLE_FACES',
  'HEAD_DIRECTION_AWAY',
  'CAMERA_DISCONNECTED',
  'CAMERA_PERMISSION_DENIED',
  'PROCTORING_UNAVAILABLE',
  'PHONE_DETECTED', // optional – only accepted when cfg.phoneDetection is on
  'AUDIO_ACTIVITY', // optional – only accepted when cfg.audioMonitoring is on
]);

const OPTIONAL_TYPES = Object.freeze({ PHONE_DETECTED: 'phoneDetection', AUDIO_ACTIVITY: 'audioMonitoring' });

const SEVERITY = Object.freeze({
  TAB_SWITCH: 'MEDIUM',
  WINDOW_BLUR: 'LOW',
  FULLSCREEN_EXIT: 'LOW',
  COPY_ATTEMPT: 'LOW',
  CUT_ATTEMPT: 'LOW',
  PASTE_ATTEMPT: 'LOW',
  RESTRICTED_SHORTCUT: 'LOW',
  CONTEXT_MENU: 'LOW',
  FACE_NOT_DETECTED: 'MEDIUM',
  MULTIPLE_FACES: 'MEDIUM',
  HEAD_DIRECTION_AWAY: 'MEDIUM',
  CAMERA_DISCONNECTED: 'MEDIUM',
  CAMERA_PERMISSION_DENIED: 'MEDIUM',
  PROCTORING_UNAVAILABLE: 'INFO',
  PHONE_DETECTED: 'MEDIUM',
  AUDIO_ACTIVITY: 'LOW',
});

const REVIEW_STATUS = Object.freeze(['Pending', 'Reviewed', 'Dismissed']);
const CASE_STATUS = Object.freeze(['Clear', 'Needs Review', 'Under Review', 'Resolved', 'Escalated']);

// [min, max, default]
const CONFIG_LIMITS = Object.freeze({
  detectionFps: [0.5, 4, 2],
  poseFps: [0.5, 4, 1],
  noFaceSeconds: [3, 120, 8],
  multiFaceSeconds: [1, 60, 3],
  headAwaySeconds: [2, 120, 2],
yawThreshold: [0.1, 0.5, 0.20],
pitchThreshold: [0.08, 0.5, 0.15],
eventCooldownSeconds: [0, 600, 10],
  batchIntervalSeconds: [5, 120, 15],
});
const CONFIG_FLAGS = Object.freeze(['enabled', 'cameraRequired', 'requireFullscreen', 'blockPaste', 'phoneDetection', 'audioMonitoring']);

const MAX_EVENTS_PER_REQUEST = 25;
const MAX_EVENTS_PER_ATTEMPT = Number(process.env.PROCTORING_MAX_EVENTS_PER_ATTEMPT || 2000);
const MAX_DURATION_MS = 12 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const PAST_SKEW_MS = 5 * 60 * 1000;
const META_MAX_BYTES = 300;
const META_KEYS = Object.freeze({
  direction: ['LEFT', 'RIGHT', 'UP', 'DOWN', 'AWAY'], // enum
  faceCount: 'int',
  key: 'string',
  reason: 'string',
  count: 'int',
  fps: 'number',
  inferenceMs: 'number',
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Normalises a (possibly hostile / partial) aiProctoring object coming from an
 * exam-admin form into safe stored values. Unknown keys are dropped.
 */
function normalizeConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const k of CONFIG_FLAGS) if (src[k] !== undefined) out[k] = src[k] === true || src[k] === 'true';
  for (const [k, [lo, hi, def]] of Object.entries(CONFIG_LIMITS)) {
    if (src[k] === undefined) continue;
    const n = Number(src[k]);
    out[k] = Number.isFinite(n) ? clamp(n, lo, hi) : def;
  }
  if (src.consentVersion !== undefined) out.consentVersion = String(src.consentVersion).replace(/[^\w.-]/g, '').slice(0, 20) || 'v1';
  return out;
}

/** Effective config for the client = stored config merged over defaults. */
function effectiveConfig(stored = {}) {
  const s = stored && typeof stored.toObject === 'function' ? stored.toObject() : stored || {};
  const cfg = {
    enabled: false,
    cameraRequired: true,
    requireFullscreen: false,
    blockPaste: false,
    phoneDetection: false,
    audioMonitoring: false,
    consentVersion: 'v1',
  };
  for (const [k, [, , def]] of Object.entries(CONFIG_LIMITS)) cfg[k] = def;
  Object.assign(cfg, normalizeConfig(s));
  return cfg;
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const out = {};
  for (const [k, rule] of Object.entries(META_KEYS)) {
    const v = meta[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(rule)) {
      if (rule.includes(v)) out[k] = v;
    } else if (rule === 'int') {
      if (Number.isInteger(v) && v >= 0 && v <= 1e6) out[k] = v;
    } else if (rule === 'number') {
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6) out[k] = Math.round(v * 1000) / 1000;
    } else if (rule === 'string') {
      if (typeof v === 'string') out[k] = v.replace(/[\u0000-\u001f<>]/g, '').slice(0, 60);
    }
  }
  if (!Object.keys(out).length) return undefined;
  return Buffer.byteLength(JSON.stringify(out)) <= META_MAX_BYTES ? out : undefined;
}

/**
 * Validates a candidate-submitted batch. Never throws; returns
 *   { events: [clean...], rejected: n, error?: string }
 * `clean` contains ONLY fields the candidate is permitted to influence; ids,
 * review state, severity and timestamps of creation are decided by the server.
 */
function validateEventBatch(body, { now = Date.now(), attemptCreatedAt = 0, config = {} } = {}) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.events)) return { events: [], rejected: 0, error: 'events must be an array' };
  if (body.events.length === 0) return { events: [], rejected: 0 };
  if (body.events.length > MAX_EVENTS_PER_REQUEST) return { events: [], rejected: body.events.length, error: `at most ${MAX_EVENTS_PER_REQUEST} events per request` };

  const events = [];
  let rejected = 0;
  const lo = Math.max(0, Number(attemptCreatedAt) || 0) - PAST_SKEW_MS;
  const hi = now + FUTURE_SKEW_MS;
  const seen = new Set();

  for (const e of body.events) {
    if (!e || typeof e !== 'object') { rejected++; continue; }
    if (!EVENT_TYPES.includes(e.type)) { rejected++; continue; }
    const gate = OPTIONAL_TYPES[e.type];
    if (gate && !config[gate]) { rejected++; continue; }
    if (typeof e.clientEventId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(e.clientEventId)) { rejected++; continue; }

    let at = now;
    if (e.at !== undefined) {
      at = typeof e.at === 'number' ? e.at : Date.parse(e.at);
      if (!Number.isFinite(at) || at < lo || at > hi) { rejected++; continue; }
    }
    const clean = { type: e.type, clientEventId: e.clientEventId, at: new Date(at) };

    if (e.durationMs !== undefined && e.durationMs !== null) {
      if (!Number.isFinite(e.durationMs) || e.durationMs < 0 || e.durationMs > MAX_DURATION_MS) { rejected++; continue; }
      clean.durationMs = Math.round(e.durationMs);
    }
    if (e.confidence !== undefined && e.confidence !== null) {
      if (!Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1) { rejected++; continue; }
      clean.confidence = Math.round(e.confidence * 1000) / 1000;
    }
    const meta = sanitizeMeta(e.meta);
    if (meta) clean.meta = meta;

    // Same episode twice in one request: keep the later (end) version with the longer duration.
    const key = clean.clientEventId;
    if (seen.has(key)) {
      const i = events.findIndex((x) => x.clientEventId === key);
      if ((clean.durationMs || 0) >= (events[i].durationMs || 0)) events[i] = { ...events[i], ...clean, at: events[i].at < clean.at ? events[i].at : clean.at };
      continue;
    }
    seen.add(key);
    events.push(clean);
  }
  return { events, rejected };
}

module.exports = {
  EVENT_TYPES,
  SEVERITY,
  REVIEW_STATUS,
  CASE_STATUS,
  CONFIG_LIMITS,
  MAX_EVENTS_PER_REQUEST,
  MAX_EVENTS_PER_ATTEMPT,
  normalizeConfig,
  effectiveConfig,
  sanitizeMeta,
  validateEventBatch,
};
