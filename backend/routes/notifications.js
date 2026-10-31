const express = require('express');
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');
const { useIdParams, parsePaging, isHttpsUrl } = require('../utils/http');

const router = express.Router();
useIdParams(router, 'id');

const MAX_SUBSCRIPTIONS = 10;

// GET /api/notifications
router.get('/', auth, async (req, res) => {
  try {
    const { limit, skip } = parsePaging(req.query, { defaultLimit: 30, maxLimit: 100 });
    const notifications = await Notification.find({ user: req.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .populate('sender', 'username displayName avatar')
      .populate('channel', 'name')
      .populate('server', 'name icon');
    const unreadCount = await Notification.countDocuments({ user: req.userId, read: false });
    res.json({ notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { read: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    res.json({ notification: notif });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.userId, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// POST /api/notifications/subscribe - Save push subscription
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    const validKey = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
    if (!isHttpsUrl(endpoint) || !validKey(keys?.p256dh) || !validKey(keys?.auth)) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }

    const existing = await PushSubscription.exists({ user: req.userId, endpoint });
    if (!existing && await PushSubscription.countDocuments({ user: req.userId }) >= MAX_SUBSCRIPTIONS) {
      return res.status(400).json({ error: 'Too many devices subscribed to notifications' });
    }

    await PushSubscription.updateOne(
      { user: req.userId, endpoint },
      { user: req.userId, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// POST /api/notifications/unsubscribe - Remove push subscription
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== 'string' || !endpoint) {
      return res.status(400).json({ error: 'Endpoint required' });
    }
    await PushSubscription.deleteOne({ user: req.userId, endpoint });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

module.exports = router;
