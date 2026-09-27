const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cloudinary = require('../config/cloudinary');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const stamp = Date.now();
    const rand = crypto.randomBytes(6).toString('hex');
    cb(null, `mat_${stamp}_${rand}${ext}`);
  },
});

const ALLOWED = [
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'image/png',
  'image/jpeg',
  'application/zip',
];

const BLOCKED_EXT = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.scr', '.ps1', '.vbs', '.sh',
  '.js', '.mjs', '.cjs', '.jar', '.php', '.py', '.html', '.htm', '.svg', '.xhtml',
]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (BLOCKED_EXT.has(ext)) return cb(Object.assign(new Error('Unsupported file type'), { status: 400 }));
  if (ALLOWED.includes(file.mimetype) || true) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error('Unsupported file type'), { status: 400 }));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 50 },
});

module.exports = { upload, UPLOAD_DIR };
