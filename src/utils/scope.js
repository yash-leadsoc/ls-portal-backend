function buOf(user = {}) {
  if (user.role === 'bu') return user._id;
  if (user.role === 'manager' || user.role === 'employee') return user.businessUnit || null;
  return null;
}
function seesAll(user = {}) {
  return user.role === 'admin' || user.role === 'cto';
}
module.exports = { buOf, seesAll };

async function ownerScope(user = {}, wanted = null) {
  const mongoose = require('mongoose');
  if (user.role === 'bu') {
    if (wanted && String(wanted) !== String(user._id) && inScope(user, wanted)) {
      const sub = await mongoose.model('User').findById(wanted).select('category');
      if (sub) return { businessUnit: sub._id, category: sub.category || null };
    }
    return { businessUnit: user._id, category: user.category || null };
  }
  const buId = user.businessUnit || null;
  if (!buId) return { businessUnit: null, category: null };
  const bu = await mongoose.model('User').findById(buId).select('category');
  return { businessUnit: buId, category: bu?.category || null };
}
module.exports.ownerScope = ownerScope;


function scopeIds(user = {}) {
  if (user.$locals && Array.isArray(user.$locals.buScope)) return user.$locals.buScope;
  const one = buOf(user);
  return one ? [one] : [];
}

function contentIds(user = {}) {
  if (user.$locals && Array.isArray(user.$locals.contentScope)) return user.$locals.contentScope;
  return scopeIds(user);
}

function asFilter(ids) {
  if (!ids.length) return null;
  return ids.length === 1 ? ids[0] : { $in: ids };
}

function buFilter(user) {
  return asFilter(scopeIds(user));
}

function contentFilter(user) {
  return asFilter(contentIds(user));
}

function inScope(user, id) {
  if (!id) return false;
  const v = String(id._id || id);
  return scopeIds(user).some((x) => String(x) === v);
}

function inContent(user, id) {
  if (!id) return false;
  const v = String(id._id || id);
  return contentIds(user).some((x) => String(x) === v);
}

function writeBU(req) {
  const wanted = req.body && req.body.businessUnit;
  if (req.user.role === 'bu' && wanted && inScope(req.user, wanted)) return wanted;
  return buOf(req.user);
}

async function computeScope(user) {
  const User = require('../models/User');
  const Category = require('../models/Category');
  if (!user || !['bu', 'manager', 'employee'].includes(user.role)) return;

  const unitId = user.role === 'bu' ? user._id : user.businessUnit;
  if (!unitId) return;
  const unit = user.role === 'bu' ? user : await User.findById(unitId).select('category');
  const cat = unit && unit.category ? await Category.findById(unit.category._id || unit.category).select('parent') : null;
  if (!cat) return;

  if (!cat.parent) {
    const subs = await Category.find({ parent: cat._id }).select('_id');
    const subUnits = subs.length
      ? await User.find({ role: 'bu', headOnly: { $ne: true }, category: { $in: subs.map((c) => c._id) } }).select('_id')
      : [];
    const ids = [unitId, ...subUnits.map((u) => u._id)];
    if (user.role === 'bu') {
      user.$locals.buScope = ids;
      user.$locals.contentScope = ids;
      user.$locals.isCategoryHead = true;
    }
    return;
  }

  const heads = await User.find({ role: 'bu', headOnly: { $ne: true }, category: cat.parent }).select('_id');
  user.$locals.contentScope = [unitId, ...heads.map((h) => h._id)];
}

module.exports.scopeIds = scopeIds;
module.exports.contentIds = contentIds;
module.exports.buFilter = buFilter;
module.exports.contentFilter = contentFilter;
module.exports.inScope = inScope;
module.exports.inContent = inContent;
module.exports.writeBU = writeBU;
module.exports.computeScope = computeScope;
