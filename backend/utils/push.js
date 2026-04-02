const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const initWebPush = () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@royalbeacon.app';

  if (!publicKey || !privateKey) {
    console.warn('VAPID keys missing. Web push disabled.');
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
};

const sendPushToUser = async (userId, payload) => {
  try {
    const subs = await PushSubscription.find({ user: userId });
    const sendPromises = subs.map(async (sub) => {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: sub.keys
        }, JSON.stringify(payload));
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
        }
      }
    });
    await Promise.all(sendPromises);
  } catch (error) {
    console.error('Push send failed:', error);
  }
};

module.exports = { initWebPush, sendPushToUser };
