const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'moderator', 'member'],
    default: 'member'
  },
  nickname: {
    type: String,
    maxlength: 32,
    default: ''
  },
  joinedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const serverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 64
  },
  description: {
    type: String,
    maxlength: 256,
    default: ''
  },
  icon: {
    type: String,
    default: ''
  },
  banner: {
    type: String,
    default: ''
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [memberSchema],
  channels: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel'
  }],
  inviteCode: {
    type: String,
    unique: true
  },
  settings: {
    defaultChannel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Channel'
    },
    isPublic: { type: Boolean, default: true },
    allowInvites: { type: Boolean, default: true },
    spamFilter: { type: Boolean, default: false },
    filteredWords: [{ type: String }]
  }
}, {
  timestamps: true
});

serverSchema.index({ name: 'text', description: 'text' });

// Generate invite code
serverSchema.pre('save', function(next) {
  if (!this.inviteCode) {
    this.inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('Server', serverSchema);
