const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const cron = require('node-cron');

dotenv.config();

const { validateEnv, corsOrigin } = require('./config/env');
validateEnv();

const connectDB = require('./config/db');
const { setupSocket } = require('./socket');
const { processScheduledMessages } = require('./utils/scheduled');
const { initWebPush } = require('./utils/push');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const serverRoutes = require('./routes/servers');
const channelRoutes = require('./routes/channels');
const messageRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');

const isProd = process.env.NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);

// Trust Render/Vercel reverse proxy (fixes express-rate-limit X-Forwarded-For error)
app.set('trust proxy', 1);

// Only origins listed in CLIENT_URL (plus localhost in development) may call the API
const corsOptions = {
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true
};

// Socket.IO setup
const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e6
});

// Make io accessible
app.set('io', io);

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(morgan(isProd ? 'combined' : 'dev'));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Much stricter limits on credential endpoints to slow down password guessing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again in 15 minutes.' }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created, please try again later.' }
});

app.use('/api/', limiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

// Health checks
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('Royal Beacon Backend is running. Live at /api/health');
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';

  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Invalid upload';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON';
  }

  if (status >= 500) console.error('Server error:', err);

  res.status(status).json({
    // Never leak internal error details to clients in production
    error: status >= 500 && isProd ? 'Internal server error' : message,
    ...(!isProd && status >= 500 && { stack: err.stack })
  });
});

// Setup Socket.IO
setupSocket(io);

// Setup Web Push
initWebPush();

// Cron job for scheduled messages - every minute
cron.schedule('* * * * *', () => {
  processScheduledMessages(io);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🏰 Royal Beacon server running on port ${PORT}`);
});

module.exports = { app, server, io };
