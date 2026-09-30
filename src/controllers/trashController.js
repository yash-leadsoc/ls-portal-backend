const mongoose = require('mongoose');
const Trash = require('../models/Trash');
const { restoreFromTrash, purgeEntry } = require('../utils/trash');
const { logAudit } = require('../utils/audit');

require('../models/Document');
require('../models/Question');
require('../models/Answer');
require('../models/Availability');
require('../models/Checklist');
require('../models/Writeup');
require('../models/Domain');
require('../models/Category');
require('../models/Company');
require('../models/InterviewMaterial');
require('../models/Exercise');
require('../models/User');

function summary(entry) {
  const now = Date.now();
  return {
    id: entry._id,
    entity: entry.entity,
    label: entry.label,
    mode: entry.mode,
    itemCount: entry.mode === 'hard' ? entry.items.length : entry.refs.length,
    deletedByName: entry.deletedByName,
    deletedByRole: entry.deletedByRole,
    deletedAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    daysLeft: Math.max(0, Math.ceil((new Date(entry.expiresAt).getTime() - now) / 86400000)),
  };
}

exports.list = async (req, res) => {
  const filter = { expiresAt: { $gt: new Date() } };
  if (req.query.entity) filter.entity = String(req.query.entity);
  const entries = await Trash.find(filter)
    .select('-items.doc')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  const list = entries.map((e) => summary({ ...e, items: e.items || [], refs: e.refs || [] }));
  res.json({ items: list, retentionDays: Trash.RETENTION_DAYS });
};

exports.restore = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Item not found' });
  const entry = await Trash.findById(req.params.id);
  if (!entry || entry.expiresAt <= new Date()) return res.status(404).json({ message: 'Item not found or already expired' });

  await restoreFromTrash(entry);
  await logAudit(req, { action: 'restore', entity: entry.entity, entityId: entry._id, entityLabel: entry.label });
  res.json({ message: `${entry.label || 'Item'} restored` });
};

exports.purge = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Item not found' });
  const entry = await Trash.findById(req.params.id);
  if (!entry) return res.status(404).json({ message: 'Item not found' });

  await purgeEntry(entry);
  await logAudit(req, { action: 'permanent-delete', entity: entry.entity, entityId: entry._id, entityLabel: entry.label });
  res.json({ message: `${entry.label || 'Item'} permanently deleted` });
};