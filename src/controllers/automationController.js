const MailLog = require('../models/MailLog');
const automation = require('../services/automation');
const { logAudit } = require('../utils/audit');

exports.status = async (req, res) => {
  res.json(await automation.status());
};

exports.save = async (req, res) => {
  const settings = await automation.saveSettings(req.body || {}, req.user._id);
  await logAudit(req, { action: 'update', entity: 'mail.automation', entityLabel: 'Email automation settings' });
  res.json({ settings, message: 'Automation settings saved' });
};

exports.preview = async (req, res) => {
  const kind = ['management', 'bu', 'engineer'].includes(req.body && req.body.kind) ? req.body.kind : 'management';
  res.json(await automation.weeklyPreview(kind));
};

exports.test = async (req, res) => {
  await automation.weeklyTest(req.user);
  res.json({ message: `Test report sent to ${req.user.email}` });
};

exports.runWeekly = async (req, res) => {
  const r = await automation.runWeekly({ trigger: `manual by ${req.user.name}` });
  await logAudit(req, {
    action: 'send',
    entity: 'mail.weekly',
    entityLabel: `Weekly progress report (${r.management} management, ${r.bu} BU, ${r.engineers} engineers)`,
  });
  res.status(202).json({ ...r, message: 'Weekly report is being sent' });
};

exports.runInactivity = async (req, res) => {
  const r = await automation.runInactivity({});
  res.status(202).json({ ...r, message: r.queued ? `${r.queued} reminder(s) are being sent` : 'No engineer needs a reminder right now' });
};

exports.logs = async (req, res) => {
  const filter = {};
  if (req.query.kind) filter.kind = String(req.query.kind);
  if (req.query.status) filter.status = String(req.query.status);
  const logs = await MailLog.find(filter).sort({ createdAt: -1 }).limit(Math.min(200, Number(req.query.limit) || 100)).lean();
  res.json({ logs });
};
