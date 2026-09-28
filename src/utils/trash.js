const fs = require('fs');
const mongoose = require('mongoose');
const Trash = require('../models/Trash');
const cloudinary = require('../config/cloudinary');

function buFor(user = {}) {
  if (user.role === 'bu') return user._id;
  if (user.role === 'manager' || user.role === 'employee') return user.businessUnit || null;
  return null;
}

function actor(req) {
  const u = (req && req.user) || {};
  return {
    deletedBy: u._id || null,
    deletedByName: u.name || '',
    deletedByRole: u.role || '',
    businessUnit: buFor(u),
  };
}

function toPlain(doc) {
  if (!doc) return doc;
  return typeof doc.toObject === 'function' ? doc.toObject({ depopulate: true, virtuals: false }) : doc;
}

async function moveToTrash(req, { entity, label, docs = [], files = [] }) {
  const items = docs
    .filter((d) => d && d.doc)
    .map(({ model, doc }) => ({ model, doc: toPlain(doc) }));
  if (!items.length) return null;

  const trash = await Trash.create({ entity, label, mode: 'hard', items, files, ...actor(req) });

  for (const { model, doc } of items) {
    await mongoose.model(model).collection.deleteOne({ _id: doc._id });
  }
  return trash;
}

async function archiveToTrash(req, { entity, label, model, id }) {
  return Trash.create({ entity, label, mode: 'archive', refs: [{ model, id }], ...actor(req) });
}

async function restoreFromTrash(entry) {
  if (entry.mode === 'archive') {
    for (const { model, id } of entry.refs) {
      await mongoose.model(model).collection.updateOne({ _id: id }, { $set: { active: true } });
    }
  } else {
    for (const { model, doc } of entry.items) {
      const col = mongoose.model(model).collection;
      const exists = await col.findOne({ _id: doc._id }, { projection: { _id: 1 } });
      if (!exists) await col.insertOne(doc);
    }
  }
  await Trash.deleteOne({ _id: entry._id });
}

async function destroyFiles(entry) {
  for (const f of entry.files || []) {
    if (f.publicId) {
      try {
        await cloudinary.uploader.destroy(f.publicId, { resource_type: f.resourceType || 'image', type: 'upload' });
      } catch (e) {}
    }
    if (f.localPath) {
      try {
        if (fs.existsSync(f.localPath)) fs.unlinkSync(f.localPath);
      } catch (e) {}
    }
  }
}

async function purgeEntry(entry) {
  if (entry.mode === 'hard') await destroyFiles(entry);
  await Trash.deleteOne({ _id: entry._id });
}

async function purgeExpired() {
  const expired = await Trash.find({ expiresAt: { $lte: new Date() } }).limit(500);
  for (const entry of expired) {
    try {
      await purgeEntry(entry);
    } catch (e) {}
  }
  if (expired.length) {
    require('./systemLog').logSystem('info', 'recycle-bin', `Permanently removed ${expired.length} expired Recycle Bin item(s)`);
  }
  return expired.length;
}

function startTrashPurgeJob(intervalMs = 6 * 60 * 60 * 1000) {
  const run = () => purgeExpired().catch(() => {});
  setTimeout(run, 60 * 1000).unref();
  return setInterval(run, intervalMs).unref();
}

module.exports = { moveToTrash, archiveToTrash, restoreFromTrash, purgeEntry, purgeExpired, startTrashPurgeJob };