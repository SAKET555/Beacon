const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 64
  },
  type: {
    type: String,
    enum: ['text', 'announcement', 'dm'],
    default: 'text'
  },
  server: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Server',
    default: null
  },
  topic: {
    type: String,
    maxlength: 256,
    default: ''
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  pinnedMessages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  readBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastRead: { type: Date, default: Date.now },
    _id: false
  }],
  settings: {
    slowMode: { type: Number, default: 0 },
    nsfw: { type: Boolean, default: false },
    locked: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

channelSchema.index({ server: 1, name: 1 });

module.exports = mongoose.model('Channel', channelSchema);
