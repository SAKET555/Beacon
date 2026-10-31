const express = require('express');
const auth = require('../middleware/auth');
const { upload, imageUpload } = require('../middleware/upload');
const cloudinary = require('../config/cloudinary');
const { matchesDeclaredType } = require('../utils/fileSignature');

const router = express.Router();

const streamToCloudinary = (buffer, options) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
    if (error) reject(error);
    else resolve(result);
  });
  stream.end(buffer);
});

// Rejects files whose bytes do not match the declared Content-Type.
const verifyFile = (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  if (!matchesDeclaredType(req.file.buffer, req.file.mimetype)) {
    return res.status(400).json({ error: 'File content does not match its type' });
  }
  next();
};

router.post('/', auth, upload.single('file'), verifyFile, async (req, res) => {
  try {
    const result = await streamToCloudinary(req.file.buffer, {
      folder: 'royal-beacon/attachments', resource_type: 'auto', use_filename: true, unique_filename: true
    });
    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      type: req.file.mimetype,
      name: req.file.originalname.slice(0, 255),
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.post('/avatar', auth, imageUpload.single('avatar'), verifyFile, async (req, res) => {
  try {
    const result = await streamToCloudinary(req.file.buffer, {
      folder: 'royal-beacon/avatars', resource_type: 'image',
      transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }]
    });
    res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (error) {
    res.status(500).json({ error: 'Avatar upload failed' });
  }
});

router.post('/server-icon', auth, imageUpload.single('icon'), verifyFile, async (req, res) => {
  try {
    const result = await streamToCloudinary(req.file.buffer, {
      folder: 'royal-beacon/server-icons', resource_type: 'image',
      transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'center' }]
    });
    res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (error) {
    res.status(500).json({ error: 'Server icon upload failed' });
  }
});

module.exports = router;
