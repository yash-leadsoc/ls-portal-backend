const User = require('../models/User');

async function unitsFor(person) {
  if (!person || person.role !== 'bu') return [];
  const ids = (person.unitAccess || []).map((a) => a.unit);
  const others = ids.length
    ? await User.find({ _id: { $in: ids }, role: 'bu', active: true }).populate('category', 'name').select('name category')
    : [];
  const typeOf = new Map((person.unitAccess || []).map((a) => [String(a.unit), a.type]));
  const list = [];
  if (!person.headOnly) {
    const self = await User.findById(person._id).populate('category', 'name').select('name category');
    list.push({ id: String(person._id), name: self.name, categoryName: self.category?.name || null, type: 'own' });
  }
  others.forEach((u) =>
    list.push({ id: String(u._id), name: u.name, categoryName: u.category?.name || null, type: typeOf.get(String(u._id)) || 'permanent' })
  );
  return list;
}

function canActAs(person, unitId) {
  if (!person || person.role !== 'bu' || !unitId) return false;
  if (String(person._id) === String(unitId)) return !person.headOnly;
  return (person.unitAccess || []).some((a) => String(a.unit) === String(unitId));
}

async function headsOf(unitIds) {
  const ids = unitIds.map(String);
  const heads = await User.find({ role: 'bu', active: true, 'unitAccess.unit': { $in: ids } }).select('name employeeCode unitAccess loginDisabled');
  const map = new Map(ids.map((id) => [id, []]));
  heads.forEach((h) =>
    (h.unitAccess || []).forEach((a) => {
      const k = String(a.unit);
      if (map.has(k)) map.get(k).push({ id: String(h._id), name: h.name, employeeCode: h.employeeCode, type: a.type, since: a.since });
    })
  );
  return map;
}

module.exports = { unitsFor, canActAs, headsOf };
