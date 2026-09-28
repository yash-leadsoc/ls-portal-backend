const webpush = require('web-push');

const PushSubscription = require('../models/PushSubscription');
const Notification = require('../models/Notification');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const URGENT_TYPES = new Set(['SYSTEM_ALERT']);

async function sendPushToUser(userId, payload) {
  const options = {
    TTL: Number(process.env.PUSH_TTL_SECONDS || 3 * 24 * 60 * 60),
    urgency: URGENT_TYPES.has(payload && payload.type) ? 'high' : 'normal',
  };
  const subscriptions = await PushSubscription.find({
    user: userId,
  });

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
        },
        JSON.stringify(payload),
        options
      );
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await PushSubscription.deleteOne({
          _id: subscription._id,
        });
      }
    }
  }
}

async function createNotification({
  userId,
  type,
  title,
  body,
  url = '/',
}) {
  try {
    const notification = await Notification.create({
      recipient: userId,
      type,
      title,
      body,
      url,
    });

    await sendPushToUser(userId, {
      title,
      body,
      url,
      notificationId: notification._id,
      type,
    });

    return notification;
  } catch (error) {
    return null;
  }
}

async function notifyUsers(userIds, data) {
  const uniqueIds = [
    ...new Set(userIds.map((id) => String(id))),
  ];

  await Promise.all(
    uniqueIds.map((userId) =>
      createNotification({
        userId,
        ...data,
      })
    )
  );
}

module.exports = {
  createNotification,
  notifyUsers,
  sendPushToUser,
};
