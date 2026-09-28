const SystemLog = require('../models/SystemLog');

async function logSystem(level, source, message, meta = {}) {
  try {
    if (level === 'error') process.stderr.write(`[${source}] ${message}\n`);
    await SystemLog.create({ level, source, message: String(message).slice(0, 1000), meta });
  } catch (e) {}
}

module.exports = { logSystem };
