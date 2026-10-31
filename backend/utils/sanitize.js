const { isId, isHttpsUrl, cleanString } = require('./http');

// Only these keys can ever be written from a request body (prevents mass assignment).
const sanitizeServerSettings = (input) => {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;

  ['isPublic', 'allowInvites', 'spamFilter'].forEach(key => {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  });
  if (Array.isArray(input.filteredWords)) {
    out.filteredWords = input.filteredWords
      .filter(word => typeof word === 'string')
      .map(word => word.trim().slice(0, 50))
      .filter(Boolean)
      .slice(0, 200);
  }
  // Caller must confirm the channel belongs to the server before applying this.
  if (isId(input.defaultChannel)) out.defaultChannel = input.defaultChannel;
  return out;
};

const sanitizeChannelSettings = (input) => {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;

  ['nsfw', 'locked'].forEach(key => {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  });
  if (Number.isInteger(input.slowMode)) {
    out.slowMode = Math.min(Math.max(input.slowMode, 0), 21600);
  }
  return out;
};

// Attachments must come from our own Cloudinary account (what /api/upload returns).
const isOwnMediaUrl = (value) => {
  if (!isHttpsUrl(value)) return false;
  const url = new URL(value);
  if (url.hostname !== 'res.cloudinary.com') return false;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  return !cloud || url.pathname.startsWith(`/${cloud}/`);
};

const sanitizeAttachments = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 10)
    .filter(item => item && typeof item === 'object' && isOwnMediaUrl(item.url))
    .map(item => ({
      url: item.url,
      publicId: cleanString(item.publicId, 256) || undefined,
      type: cleanString(item.type, 100) || undefined,
      name: cleanString(item.name, 255) || undefined,
      size: Number.isFinite(item.size) && item.size >= 0 ? item.size : undefined
    }));
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const isHexColor = (value) => typeof value === 'string' && HEX_COLOR.test(value);

module.exports = {
  sanitizeServerSettings,
  sanitizeChannelSettings,
  sanitizeAttachments,
  isHexColor
};
