const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  server: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Server',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'server_update', 'server_delete',
      'channel_create', 'channel_update', 'channel_delete',
      'member_kick', 'member_ban', 'member_role_update',
      'message_pin', 'message_delete',
      'settings_update', 'invite_create',
      'moderation_action'
    ]
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  target: {
    type: String,
    default: ''
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

auditLogSchema.index({ server: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
