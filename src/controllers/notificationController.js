const Notification = require('../models/Notification');
const PushSubscription = require('../models/PushSubscription');

exports.getPublicKey = async (req, res) => {
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY,
  });
};

exports.subscribe = async (req, res) => {
  try {
    const { subscription } = req.body;

    if (!subscription?.endpoint) {
      return res.status(400).json({
        message: 'Invalid push subscription',
      });
    }

    await PushSubscription.findOneAndUpdate(
      {
        endpoint: subscription.endpoint,
      },
      {
        user: req.user._id,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      {
        upsert: true,
        new: true,
      }
    );

    res.json({
      message: 'Push notifications enabled',
    });
  } catch (error) {
    res.status(500).json({
      message: 'Could not save push subscription',
    });
  }
};

exports.unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body;

    await PushSubscription.deleteOne({
      user: req.user._id,
      endpoint,
    });

    res.json({
      message: 'Push notifications disabled',
    });
  } catch (error) {
    res.status(500).json({
      message: 'Could not disable notifications',
    });
  }
};

exports.list = async (req, res) => {
  try {
    const notifications = await Notification.find({
      recipient: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      read: false,
    });

    res.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Could not load notifications',
    });
  }
};

exports.markRead = async (req, res) => {
  await Notification.updateOne(
    {
      _id: req.params.id,
      recipient: req.user._id,
    },
    {
      $set: { read: true },
    }
  );

  res.json({
    message: 'Notification marked as read',
  });
};

exports.markAllRead = async (req, res) => {
  await Notification.updateMany(
    {
      recipient: req.user._id,
      read: false,
    },
    {
      $set: { read: true },
    }
  );

  res.json({
    message: 'All notifications marked as read',
  });
};
