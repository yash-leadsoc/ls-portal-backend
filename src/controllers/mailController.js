const mongoose = require('mongoose');
const User = require('../models/User');
const EmailCampaign = require('../models/EmailCampaign');
const MailAccount = require('../models/MailAccount');
const { canReceive, getServer, saveServer, verifyAccount, senderFor, openSender, setSystemSender, getSystemSenderId } = require('../services/mailer');
const { encrypt } = require('../utils/mailCrypto');
const { logAudit } = require('../utils/audit');

const GROUPS = {
  all: { role: { $in: ['bu', 'manager', 'cto', 'employee'] } },
  bus: { role: 'bu' },
  trainers: { role: 'manager' },
  ctos: { role: 'cto' },
  engineers: { role: 'employee' },
};
const ROLE_LABEL = { bu: 'Business Unit', manager: 'Trainer', cto: 'CTO', employee: 'Engineer', admin: 'Admin' };
const MAX_RECIPIENTS = 2000;

const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function personalize(template, r, html) {
  const vals = {
    name: r.name || '',
    firstName: String(r.name || '').trim().split(/\s+/)[0] || '',
    email: r.email || '',
    employeeCode: r.employeeCode || '',
    role: r.roleLabel || '',
    bu: r.buName || '',
  };
  const src = html ? esc(template) : template;
  return src.replace(/\{\{\s*(name|firstName|email|employeeCode|role|bu)\s*\}\}/g, (_, k) => (html ? esc(vals[k]) : vals[k]));
}

function toHtml(body, r, senderName) {
  const inner = personalize(body, r, true)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, '<br>');
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;">${inner}<br><br><span style="color:#64748b;font-size:12px;">Sent by ${esc(senderName)} via LeadSoC TEDP</span></body></html>`;
}

async function loadRecipients(group) {
  const filter = { active: true, headOnly: { $ne: true }, ...(GROUPS[group] || GROUPS.all) };
  const users = await User.find(filter)
    .select('name email employeeCode role businessUnit loginDisabled')
    .populate('businessUnit', 'name')
    .sort({ role: 1, name: 1 })
    .lean();
  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    employeeCode: u.employeeCode || '',
    role: u.role,
    roleLabel: ROLE_LABEL[u.role] || u.role,
    buName: u.role === 'bu' ? u.name : (u.businessUnit && u.businessUnit.name) || '',
    canReceive: canReceive(u.email) && !u.loginDisabled,
  }));
}

const person = (req) => req.actor || req.user;

exports.config = async (req, res) => {
  const me = person(req);
  const [server, acc] = await Promise.all([getServer(), MailAccount.findOne({ user: me._id }).lean()]);
  const envFallback = !acc && server && server.source === 'env' && process.env.SMTP_USER && process.env.SMTP_PASS;
  const sendsAs = acc ? acc.smtpUser : envFallback ? process.env.SMTP_FROM || process.env.SMTP_USER : null;
  const systemId = await getSystemSenderId();
  let systemSender = null;
  if (systemId) {
    const [su, sa] = await Promise.all([User.findById(systemId).select('name').lean(), MailAccount.findOne({ user: systemId }).lean()]);
    if (su && sa) systemSender = { id: systemId, name: su.name, email: sa.smtpUser, isMe: systemId === String(me._id) };
  }
  res.json({
    systemSender,
    server: server ? { host: server.host, port: server.port, secure: !!server.secure, source: server.source } : null,
    canEditServer: me.role === 'admin' && !me.subAdmin,
    account: acc ? { smtpUser: acc.smtpUser, verifiedAt: acc.verifiedAt } : null,
    configured: !!(server && sendsAs),
    from: { name: me.name, email: me.email },
    sendsAs,
    note: !server
      ? 'The mail server is not set up yet.'
      : !sendsAs
        ? 'Add your mailbox password to start sending.'
        : `Mails are sent from ${sendsAs}.`,
  });
};

exports.saveServer = async (req, res) => {
  const me = person(req);
  if (!(me.role === 'admin' && !me.subAdmin)) return res.status(403).json({ message: 'Only the main admin can change the mail server' });
  const host = String(req.body.host || '').trim();
  const port = Number(req.body.port);
  if (!/^[a-z0-9.-]+$/i.test(host)) return res.status(400).json({ message: 'Enter a valid SMTP host, e.g. smtp.hostinger.com' });
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ message: 'Enter a valid port (usually 465 or 587)' });
  const value = await saveServer({ host, port, secure: req.body.secure }, me._id);
  await logAudit(req, { action: 'update', entity: 'mail.server', entityLabel: `${value.host}:${value.port}` });
  res.json({ server: value, message: 'Mail server saved' });
};

exports.saveAccount = async (req, res) => {
  const me = person(req);
  const smtpUser = String(req.body.smtpUser || me.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtpUser)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (!password) return res.status(400).json({ message: 'Enter the mailbox password' });
  const server = await getServer();
  if (!server) return res.status(400).json({ message: 'Set up the mail server first' });
  try {
    await verifyAccount(server, smtpUser, password);
  } catch (e) {
    return res.status(400).json({ message: `Could not sign in to ${server.host}: ${String(e.message || e).slice(0, 200)}` });
  }
  await MailAccount.findOneAndUpdate(
    { user: me._id },
    { $set: { smtpUser, passEnc: encrypt(password), verifiedAt: new Date() } },
    { upsert: true }
  );
  await logAudit(req, { action: 'update', entity: 'mail.account', entityLabel: smtpUser });
  res.json({ message: 'Mailbox connected', account: { smtpUser, verifiedAt: new Date() } });
};

exports.useForSystem = async (req, res) => {
  const me = person(req);
  if (!(me.role === 'admin' && !me.subAdmin)) return res.status(403).json({ message: 'Only the main admin can choose the system mailbox' });
  const acc = await MailAccount.findOne({ user: me._id }).lean();
  if (!acc) return res.status(400).json({ message: 'Connect your mailbox first' });
  await setSystemSender(me._id);
  await logAudit(req, { action: 'update', entity: 'mail.system', entityLabel: acc.smtpUser });
  res.json({ message: `Password-reset codes will be sent from ${acc.smtpUser}` });
};

exports.removeAccount = async (req, res) => {
  const me = person(req);
  await MailAccount.deleteOne({ user: me._id });
  await logAudit(req, { action: 'delete', entity: 'mail.account', entityLabel: me.email });
  res.json({ message: 'Mailbox removed' });
};

exports.recipients = async (req, res) => {
  const group = GROUPS[req.query.group] ? req.query.group : 'all';
  const list = (await loadRecipients(group)).filter((r) => r.id !== String(req.user._id));
  res.json({ group, recipients: list });
};

exports.send = async (req, res) => {
  const subject = String(req.body.subject || '').trim().slice(0, 200);
  const body = String(req.body.body || '').trim().slice(0, 20000);
  const group = GROUPS[req.body.group] ? req.body.group : 'all';
  const ids = Array.isArray(req.body.userIds) ? req.body.userIds.filter((id) => mongoose.isValidObjectId(id)) : null;
  if (!subject) return res.status(400).json({ message: 'Subject is required' });
  if (!body) return res.status(400).json({ message: 'Message is required' });
  const sender = person(req);
  const smtp = await senderFor(sender._id);
  if (smtp.error) return res.status(400).json({ message: smtp.error });

  let list = await loadRecipients(group);
  if (ids) {
    const set = new Set(ids.map(String));
    list = list.filter((r) => set.has(r.id));
  }
  list = list.filter((r) => r.canReceive && r.id !== String(req.user._id));
  if (!list.length) return res.status(400).json({ message: 'No recipients with a valid email address were selected' });
  if (list.length > MAX_RECIPIENTS) return res.status(400).json({ message: `Send to at most ${MAX_RECIPIENTS} people at a time` });

  const campaign = await EmailCampaign.create({
    subject,
    body,
    audience: ids ? `${group} (selected)` : group,
    sentBy: sender._id,
    senderName: sender.name,
    senderEmail: smtp.from,
    transport: 'smtp',
    status: 'queued',
    total: list.length,
    recipients: list.map((r) => ({ user: r.id, name: r.name, email: r.email })),
  });

  await logAudit(req, {
    action: 'send',
    entity: 'email',
    entityId: campaign._id,
    entityLabel: `${subject} → ${list.length} recipient(s)`,
  });

  res.status(202).json({ campaign: { id: campaign._id, total: list.length, status: 'queued' } });

  setImmediate(() => runCampaign(campaign._id, list, smtp, sender.email).catch(() => {}));
};

async function runCampaign(id, list, smtp, replyTo) {
  const campaign = await EmailCampaign.findById(id);
  if (!campaign) return;
  campaign.status = 'sending';
  await campaign.save();
  const delay = Number(process.env.MAIL_DELAY_MS || 400);
  const mailer = openSender(smtp);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    try {
      await mailer.send({
        fromName: campaign.senderName,
        replyTo,
        to: r.email,
        toName: r.name,
        subject: personalize(campaign.subject, r, false),
        text: `${personalize(campaign.body, r, false)}\n\n— Sent by ${campaign.senderName} via LeadSoC TEDP`,
        html: toHtml(campaign.body, r, campaign.senderName),
      });
      sent += 1;
      await EmailCampaign.updateOne({ _id: id }, { $set: { [`recipients.${i}.status`]: 'sent' }, $inc: { sent: 1 } });
    } catch (e) {
      failed += 1;
      const msg = String((e && (e.response?.data?.error?.message || e.message)) || 'Send failed').slice(0, 300);
      await EmailCampaign.updateOne(
        { _id: id },
        { $set: { [`recipients.${i}.status`]: 'failed', [`recipients.${i}.error`]: msg }, $inc: { failed: 1 } }
      );
      if (i === 0 && /auth|login|credentials|535|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
        mailer.close();
        await EmailCampaign.updateMany({ _id: id }, { $set: { status: 'failed', finishedAt: new Date() } });
        return;
      }
    }
    if (delay) await new Promise((r2) => setTimeout(r2, delay));
  }
  mailer.close();
  await EmailCampaign.updateOne(
    { _id: id },
    { $set: { status: sent === 0 && failed > 0 ? 'failed' : 'done', finishedAt: new Date() } }
  );
}

exports.campaigns = async (req, res) => {
  const items = await EmailCampaign.find({}).select('-recipients -body').sort({ createdAt: -1 }).limit(50).lean();
  res.json({ campaigns: items });
};

exports.campaign = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not found' });
  const c = await EmailCampaign.findById(req.params.id).lean();
  if (!c) return res.status(404).json({ message: 'Not found' });
  res.json({ campaign: c });
};

exports.preview = async (req, res) => {
  const r = {
    name: req.body.name || 'Asha Rao',
    email: req.body.email || 'asha.rao@example.com',
    employeeCode: req.body.employeeCode || 'LS-1001',
    roleLabel: req.body.roleLabel || 'Engineer',
    buName: req.body.buName || 'BE',
  };
  const sender = person(req);
  res.json({
    subject: personalize(String(req.body.subject || ''), r, false),
    html: toHtml(String(req.body.body || ''), r, sender.name),
  });
};

exports.markInterrupted = async () => {
  try {
    await EmailCampaign.updateMany({ status: { $in: ['queued', 'sending'] } }, { $set: { status: 'interrupted', finishedAt: new Date() } });
  } catch (e) {}
};
