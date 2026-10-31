const mongoose = require('mongoose');

// Strict 24-char hex ObjectId (mongoose.isValidObjectId also accepts any 12-char string).
const isId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) && mongoose.isValidObjectId(value);

// router.param handler: rejects malformed ids with 400 instead of a CastError 500.
const validateIdParam = (req, res, next, value) => {
  if (!isId(value)) return res.status(400).json({ error: 'Invalid id' });
  next();
};

const useIdParams = (router, ...names) => {
  names.forEach(name => router.param(name, validateIdParam));
};

// Caps page/limit so ?limit=1000000 cannot dump a whole collection.
const parsePaging = (query = {}, { defaultLimit = 50, maxLimit = 100 } = {}) => {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 10000);
  return { page, limit, skip: (page - 1) * limit };
};

const parseDate = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// https-only URL check for user supplied media links (avatars, icons, banners).
const isHttpsUrl = (value, maxLength = 2048) => {
  if (typeof value !== 'string' || value.length > maxLength || /\s/.test(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch (error) {
    return false;
  }
};

// '' clears the field, valid https URL is kept, anything else is invalid (returns null).
const cleanMediaUrl = (value) => {
  if (value === '' || value === null) return '';
  return isHttpsUrl(value) ? value : null;
};

const cleanString = (value, maxLength) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : null
);

module.exports = {
  isId,
  validateIdParam,
  useIdParams,
  parsePaging,
  parseDate,
  escapeRegex,
  isHttpsUrl,
  cleanMediaUrl,
  cleanString
};
