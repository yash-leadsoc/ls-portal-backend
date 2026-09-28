const Setting = require('../models/Setting');
const { logAudit } = require('../utils/audit');

const HELP_VIDEO_KEY = 'help_video';

function driveFileId(link) {
  const s = String(link || '').trim();
  if (!s) return null;
  const patterns = [
    /drive\.google\.com\/file\/d\/([\w-]{10,})/i,
    /drive\.google\.com\/open\?id=([\w-]{10,})/i,
    /drive\.google\.com\/uc\?(?:.*&)?id=([\w-]{10,})/i,
    /docs\.google\.com\/file\/d\/([\w-]{10,})/i,
    /[?&]id=([\w-]{10,})/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return /^[\w-]{20,}$/.test(s) ? s : null;
}

function shape(doc) {
  const v = (doc && doc.value) || null;
  if (!v || !v.fileId) return { video: null };
  return {
    video: {
      title: v.title || 'How to use the portal',
      description: v.description || '',
      link: v.link,
      fileId: v.fileId,
      embedUrl: `https://drive.google.com/file/d/${v.fileId}/preview`,
      updatedAt: doc.updatedAt,
    },
  };
}

exports.getHelpVideo = async (req, res) => {
  const doc = await Setting.findOne({ key: HELP_VIDEO_KEY }).lean();
  res.json(shape(doc));
};

exports.setHelpVideo = async (req, res) => {
  const { link, title, description } = req.body || {};
  if (!link || !String(link).trim()) {
    await Setting.deleteOne({ key: HELP_VIDEO_KEY });
    await logAudit(req, { action: 'delete', entity: 'setting', entityLabel: 'Portal help video' });
    return res.json({ video: null, message: 'Help video removed' });
  }
  const fileId = driveFileId(link);
  if (!fileId) {
    return res.status(400).json({ message: 'Paste a valid Google Drive video link (…/file/d/FILE_ID/view)' });
  }
  const value = {
    link: String(link).trim().slice(0, 500),
    fileId,
    title: String(title || '').trim().slice(0, 120) || 'How to use the portal',
    description: String(description || '').trim().slice(0, 1000),
  };
  const doc = await Setting.findOneAndUpdate(
    { key: HELP_VIDEO_KEY },
    { $set: { value, updatedBy: req.user._id } },
    { new: true, upsert: true }
  ).lean();
  await logAudit(req, { action: 'update', entity: 'setting', entityLabel: 'Portal help video' });
  res.json({ ...shape(doc), message: 'Help video saved' });
};
