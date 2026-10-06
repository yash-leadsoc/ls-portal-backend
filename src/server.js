require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const multer = require('multer');
const connectDB = require('./config/db');
const { startTrashPurgeJob } = require('./utils/trash');
const sanitize = require('./middleware/sanitize');
const { monitor, startMonitorJobs, flushMetrics } = require('./middleware/monitor');
const { startAlertJob } = require('./services/alerts');
const { logSystem } = require('./utils/systemLog');
const pptSubmissionRoutes = require('./routes/pptSubmission');

const isProd = process.env.NODE_ENV === 'production';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.set('etag', 'strong');

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors(
    allowedOrigins.length
      ? {
          origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
          maxAge: 86400,
        }
      : { maxAge: 86400 }
  )
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use('/api/bench/import', express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(sanitize);
app.use(monitor);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Too many login attempts. Please try again after some time.' },
});

const assistantLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.ASSISTANT_RATE_LIMIT || 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'leadsoc-portal', time: new Date() }));

app.use('/api/auth/login', loginLimiter);
app.use('/api/assistant', assistantLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/domains', require('./routes/domains'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/checklists', require('./routes/checklists'));
app.use('/api/writeups', require('./routes/writeups'));
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/ppt-submissions', pptSubmissionRoutes);
app.use('/api/qa', require('./routes/qa'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/interviews', require('./routes/interviews'));
app.use('/api/overview', require('./routes/overview'));
app.use('/api/assistant', require('./routes/assistant'));
app.use('/api/exercises', require('./routes/exercises'));
app.use('/api/streak', require('./routes/streak'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/trash', require('./routes/trash'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/resume', require('./routes/resume'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/bench', require('./routes/bench'));
app.use('/api/mail', require('./routes/mail'));
app.use((req, res) => res.status(404).json({ message: 'Not found' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  let status = err.status || err.statusCode || 500;
  if (err instanceof multer.MulterError) status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  else if (err instanceof mongoose.Error.CastError) status = 400;
  else if (err instanceof mongoose.Error.ValidationError) status = 400;

  res.locals.error = err;
  if (status >= 500) {
    logSystem('error', 'api', `${req.method} ${req.originalUrl.split('?')[0]} failed: ${err.message}`, {
      stack: String(err.stack || '').slice(0, 2000),
    });
  }
  const message = status >= 500 && isProd ? 'Server error' : err.message || 'Server error';
  res.status(status).json({ message });
});

process.on('unhandledRejection', (reason) => {
  logSystem('error', 'process', `Unhandled promise rejection: ${reason && reason.message ? reason.message : reason}`, {
    stack: String((reason && reason.stack) || '').slice(0, 2000),
  });
});

process.on('uncaughtException', (err) => {
  logSystem('error', 'process', `Uncaught exception: ${err.message}`, { stack: String(err.stack || '').slice(0, 2000) }).finally(() =>
    process.exit(1)
  );
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    startTrashPurgeJob();
    startMonitorJobs();
    startAlertJob();
    const server = app.listen(PORT);
    logSystem('info', 'server', `Server started (Node ${process.version}, pid ${process.pid})`);

    mongoose.connection.on('disconnected', () => logSystem('warn', 'database', 'Database disconnected'));
    mongoose.connection.on('reconnected', () => logSystem('info', 'database', 'Database reconnected'));
    mongoose.connection.on('error', (e) => logSystem('error', 'database', `Database error: ${e.message}`));
    server.keepAliveTimeout = 65 * 1000;
    server.headersTimeout = 66 * 1000;

    const shutdown = async () => {
      await logSystem('info', 'server', 'Server shutting down');
      await flushMetrics();
      server.close(() => {
        mongoose.connection.close(false).finally(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((err) => {
    process.stderr.write(`Database connection failed: ${err.message}\n`);
    process.exit(1);
  });
