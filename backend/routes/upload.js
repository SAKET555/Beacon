const express = require('express');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('../config/cloudinary');

const router = express.Router();

router.post('/', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    let resourceType = 'auto';
    if (req.file.mimetype.startsWith('image/')) resourceType = 'image';
    else if (req.file.mimetype.startsWith('video/')) resourceType = 'video';
    else resourceType = 'raw';

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'royal-beacon/attachments', resource_type: resourceType, use_filename: true, unique_filename: true },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url, publicId: result.public_id, type: req.file.mimetype, name: req.file.originalname, size: req.file.size });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'royal-beacon/avatars', resource_type: 'image', transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }] },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });
    res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (error) {
    res.status(500).json({ error: 'Avatar upload failed' });
  }
});

module.exports = router;
