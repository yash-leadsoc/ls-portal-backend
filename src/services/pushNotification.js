const webpush = require('web-push');

const PushSubscription = require('../models/PushSubscription');
const Notification = require('../models/Notification');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushToUser(userId, payload) {
  const subscriptions = await PushSubscription.find({
    user: userId,
  });

  for (const subscription of subscriptions) {
    try {
      const result = await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
        },
        JSON.stringify(payload)
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
