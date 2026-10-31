// Fail fast on missing configuration instead of running in an insecure state.
const validateEnv = () => {
  const isProd = process.env.NODE_ENV === 'production';
  const required = ['MONGODB_URI', 'JWT_SECRET'];
  if (isProd) required.push('CLIENT_URL');

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (process.env.JWT_SECRET.length < 32) {
    const message = 'JWT_SECRET must be at least 32 characters. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';
    if (isProd) {
      console.error(message);
      process.exit(1);
    }
    console.warn(`Warning: ${message}`);
  }
};

// CLIENT_URL may be a comma-separated list (e.g. production + preview domains).
const getAllowedOrigins = () => (process.env.CLIENT_URL || '')
  .split(',')
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const corsOrigin = (origin, callback) => {
  // Requests without an Origin header (curl, server-to-server, same-origin) are not CORS.
  if (!origin) return callback(null, true);
  if (getAllowedOrigins().includes(origin)) return callback(null, true);
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return callback(null, true);
  }
  callback(null, false);
};

module.exports = { validateEnv, corsOrigin };
