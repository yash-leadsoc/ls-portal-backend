const User = require('../models/User');
const { streakView } = require('../utils/streak');

exports.myStreak = async (req, res) => {
  const u = await User.findById(req.user._id).select('streak role');
  res.json({ streak: streakView(u) });
};
