const Message = require('../models/Message');
const Channel = require('../models/Channel');

const processScheduledMessages = async (io) => {
  try {
    const now = new Date();
    const scheduledMessages = await Message.find({
      isScheduled: true,
      scheduledFor: { $lte: now }
    }).populate('author', 'username displayName avatar status');

    for (const message of scheduledMessages) {
      message.isScheduled = false;
      message.scheduledFor = null;
      await message.save();

      // Update channel lastMessage
      await Channel.findByIdAndUpdate(message.channel, { lastMessage: message._id });

      // Emit to channel
      io.to(`channel:${message.channel}`).emit('message:new', { message });
    }

    if (scheduledMessages.length > 0) {
      console.log(`📨 Sent ${scheduledMessages.length} scheduled messages`);
    }
  } catch (error) {
    console.error('Scheduled message processing error:', error);
  }
};

module.exports = { processScheduledMessages };
