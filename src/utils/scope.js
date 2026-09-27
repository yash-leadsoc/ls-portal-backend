function buOf(user = {}) {
  if (user.role === 'bu') return user._id;
  if (user.role === 'manager' || user.role === 'employee') return user.businessUnit || null;
  return null;
}
function seesAll(user = {}) {
  return user.role === 'admin' || user.role === 'cto';
}
module.exports = { buOf, seesAll };

async function ownerScope(user = {}) {
  const mongoose = require('mongoose');
  if (user.role === 'bu') return { businessUnit: user._id, category: user.category || null };
  const buId = user.businessUnit || null;
  if (!buId) return { businessUnit: null, category: null };
  const bu = await mongoose.model('User').findById(buId).select('category');
  return { businessUnit: buId, category: bu?.category || null };
}
module.exports.ownerScope = ownerScope;
