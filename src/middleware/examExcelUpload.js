
const multer = require('multer');
const path = require('path');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (!['.xlsx', '.xls'].includes(ext)) {
      return cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }

    cb(null, true);
  },
});

module.exports = upload;
