// Verifies uploaded bytes really are the type the client claimed (the multipart
// Content-Type header is attacker controlled).

const startsWith = (buf, bytes, offset = 0) => (
  buf.length >= offset + bytes.length && bytes.every((byte, i) => buf[offset + i] === byte)
);

const ascii = (buf, text, offset = 0) => (
  buf.length >= offset + text.length && buf.toString('latin1', offset, offset + text.length) === text
);

const isZip = (b) => startsWith(b, [0x50, 0x4B, 0x03, 0x04]) || startsWith(b, [0x50, 0x4B, 0x05, 0x06]);
const isOle = (b) => startsWith(b, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

const CHECKS = {
  'image/jpeg': (b) => startsWith(b, [0xFF, 0xD8, 0xFF]),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  'image/gif': (b) => ascii(b, 'GIF87a') || ascii(b, 'GIF89a'),
  'image/webp': (b) => ascii(b, 'RIFF') && ascii(b, 'WEBP', 8),
  'video/mp4': (b) => ascii(b, 'ftyp', 4),
  'video/webm': (b) => startsWith(b, [0x1A, 0x45, 0xDF, 0xA3]),
  'audio/mpeg': (b) => ascii(b, 'ID3') || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0),
  'audio/wav': (b) => ascii(b, 'RIFF') && ascii(b, 'WAVE', 8),
  'audio/ogg': (b) => ascii(b, 'OggS'),
  'application/pdf': (b) => ascii(b, '%PDF'),
  'application/zip': isZip,
  'application/x-zip-compressed': isZip,
  'application/msword': isOle,
  'application/vnd.ms-excel': isOle,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZip,
  'text/plain': (b) => !b.subarray(0, 8000).includes(0)
};

const matchesDeclaredType = (buffer, mimetype) => {
  const check = CHECKS[mimetype];
  return !!check && Buffer.isBuffer(buffer) && buffer.length > 0 && check(buffer);
};

module.exports = { matchesDeclaredType };
