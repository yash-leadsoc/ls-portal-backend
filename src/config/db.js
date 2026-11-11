const mongoose = require('mongoose');

const int = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Single shared connection (mongoose keeps one pool per process).
 *
 * Pool sizing is deliberately conservative: on an Atlas M0/Flex cluster the
 * limiting resource is operations/second, not connections, so a bigger pool
 * only queues more work server-side. Tune with the MONGO_* variables and
 * measure (see docs/LOAD_TESTING.md) before raising it.
 *
 *   MONGO_MAX_POOL_SIZE (alias: MONGO_POOL_SIZE, legacy) default 20
 *   MONGO_MIN_POOL_SIZE                                  default 2
 *   MONGO_SERVER_SELECTION_TIMEOUT_MS                    default 10000
 *   MONGO_SOCKET_TIMEOUT_MS                              default 45000
 *   MONGO_MAX_IDLE_TIME_MS                               default 60000
 *   MONGO_AUTO_INDEX   'false' to stop building indexes at boot (build them
 *                      once from a maintenance shell on large collections)
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  mongoose.set('strictQuery', true);
  mongoose.set('autoIndex', process.env.MONGO_AUTO_INDEX !== 'false');

  const maxPoolSize = int('MONGO_MAX_POOL_SIZE', int('MONGO_POOL_SIZE', 20));
  const minPoolSize = Math.min(int('MONGO_MIN_POOL_SIZE', 2), maxPoolSize);

  await mongoose.connect(uri, {
    maxPoolSize,
    minPoolSize,
    maxIdleTimeMS: int('MONGO_MAX_IDLE_TIME_MS', 60000),
    serverSelectionTimeoutMS: int('MONGO_SERVER_SELECTION_TIMEOUT_MS', 10000),
    socketTimeoutMS: int('MONGO_SOCKET_TIMEOUT_MS', 45000),
    retryWrites: true,
  });
}

module.exports = connectDB;
