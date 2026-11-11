/**
 * Minimal structured (JSON-lines) logger with secret redaction. Writes to stdout/
 * stderr so Docker/CloudWatch can ship it; no DB writes, no dependencies.
 */
const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|mongo_uri|private[-_]?key/i;

function redact(v, depth = 0) {
  if (v === null || typeof v !== 'object' || depth > 4) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(val, depth + 1);
  return out;
}

function write(level, msg, ctx) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(ctx ? { ctx: redact(ctx) } : {}) });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

module.exports = {
  redact,
  info: (m, c) => write('info', m, c),
  warn: (m, c) => write('warn', m, c),
  error: (m, c) => write('error', m, c),
};
