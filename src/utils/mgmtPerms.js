const Setting = require('../models/Setting');

const PERMS = [
  ['overview', 'Dashboard & portal overview'],
  ['people', 'People, BUs and engineer profiles (view)'],
  ['contact', 'Contact details & resumes'],
  ['training', 'Training progress, domains & materials (view)'],
  ['interviews', 'Interviews (view)'],
  ['interviews_manage', 'Schedule & score mock interviews'],
  ['export', 'Excel exports'],
  ['activity', 'Activity / audit log'],
  ['insights', 'Insights dashboard (incl. technical logs)'],
];
const ALL = PERMS.map(([k]) => k);

const DESIGNATIONS = ['CEO', 'CTO', 'CSO', 'CFO', 'COO', 'HR'];

const DEFAULT_PROFILES = {
  CEO: ALL.filter((k) => k !== 'interviews_manage'),
  CTO: ALL.filter((k) => k !== 'interviews_manage'),
  CSO: ALL.filter((k) => k !== 'interviews_manage'),
  CFO: ['overview', 'people', 'training', 'interviews', 'export'],
  COO: ALL.filter((k) => k !== 'interviews_manage'),
  HR: ['overview', 'people', 'contact', 'training', 'interviews', 'interviews_manage', 'export', 'activity'],
  default: ['overview', 'people', 'training', 'interviews'],
};

const KEY = 'management_profiles';

const clean = (list) => [...new Set((Array.isArray(list) ? list : []).filter((k) => ALL.includes(k)))];

async function getProfiles() {
  const doc = await Setting.findOne({ key: KEY }).lean();
  const saved = (doc && doc.value) || {};
  const out = { ...DEFAULT_PROFILES };
  Object.entries(saved).forEach(([d, list]) => (out[d] = clean(list)));
  return out;
}

async function saveProfiles(profiles, userId) {
  const value = {};
  Object.entries(profiles || {}).forEach(([d, list]) => {
    const name = String(d).trim().slice(0, 40);
    if (name) value[name] = clean(list);
  });
  await Setting.findOneAndUpdate({ key: KEY }, { $set: { value, updatedBy: userId } }, { upsert: true });
  return getProfiles();
}

const designationOf = (user) => (user && user.designation ? user.designation : 'CTO');

async function effectivePerms(user, profiles) {
  if (!user || user.role !== 'cto') return null;
  if (Array.isArray(user.permissions) && user.permissions.length) return clean(user.permissions);
  const p = profiles || (await getProfiles());
  return p[designationOf(user)] || p.default;
}

module.exports = { PERMS, ALL, DESIGNATIONS, DEFAULT_PROFILES, getProfiles, saveProfiles, effectivePerms, designationOf, clean };
