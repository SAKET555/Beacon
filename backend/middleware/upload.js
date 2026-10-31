const multer = require('multer');

const storage = multer.memoryStorage();

// SVG is intentionally not allowed: it can carry scripts.
const FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
  'application/pdf',
  'text/plain',
  'application/zip', 'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const createUpload = (allowedTypes, maxBytes) => multer({
  storage,
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) return cb(null, true);
    const error = new Error(`File type ${file.mimetype} is not allowed`);
    error.status = 400;
    cb(error, false);
  }
});

const upload = createUpload(FILE_TYPES, 10 * 1024 * 1024);
const imageUpload = createUpload(IMAGE_TYPES, 5 * 1024 * 1024);

module.exports = { upload, imageUpload };
