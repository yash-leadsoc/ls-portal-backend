const nodemailer = require('nodemailer');
const Setting = require('../models/Setting');
const MailAccount = require('../models/MailAccount');
const { decrypt } = require('../utils/mailCrypto');

const PLACEHOLDER_DOMAINS = /@(bench\.leadsoc\.local|units\.leadsoc\.local)$/i;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVER_KEY = 'mail_server';

function canReceive(email) {
  return !!email && EMAIL_RX.test(email) && !PLACEHOLDER_DOMAINS.test(email);
}

async function getServer() {
  const doc = await Setting.findOne({ key: SERVER_KEY }).lean();
  if (doc && doc.value && doc.value.host) return { ...doc.value, source: 'portal' };
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(process.env.SMTP_PORT) === 465,
      source: 'env',
    };
  }
  return null;
}

async function saveServer({ host, port, secure }, userId) {
  const value = {
    host: String(host || '').trim().slice(0, 200),
    port: Number(port) || 587,
    secure: secure === undefined ? Number(port) === 465 : !!secure,
  };
  await Setting.findOneAndUpdate({ key: SERVER_KEY }, { $set: { value, updatedBy: userId } }, { upsert: true });
  return value;
}

function makeTransport(server, user, pass) {
  return nodemailer.createTransport({
    host: server.host,
    port: Number(server.port),
    secure: !!server.secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
}

async function verifyAccount(server, user, pass) {
  const t = makeTransport(server, user, pass);
  try {
    await t.verify();
  } finally {
    t.close();
  }
}

async function senderFor(userId) {
  const server = await getServer();
  if (!server) return { error: 'The mail server is not set up yet' };
  const acc = await MailAccount.findOne({ user: userId });
  if (acc) {
    return { server, user: acc.smtpUser, pass: decrypt(acc.passEnc), from: acc.smtpUser, own: true };
  }
  if (server.source === 'env' && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return { server, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM || process.env.SMTP_USER, own: false };
  }
  return { error: 'Add your mailbox password in Mail settings first' };
}

function openSender(sender) {
  const t = makeTransport(sender.server, sender.user, sender.pass);
  return {
    async send({ fromName, replyTo, to, toName, subject, text, html }) {
      await t.sendMail({
        from: { name: fromName, address: sender.from },
        replyTo: replyTo && replyTo.toLowerCase() !== sender.from.toLowerCase() ? replyTo : undefined,
        to: toName ? { name: toName, address: to } : to,
        subject,
        text,
        html,
      });
    },
    close() {
      t.close();
    },
  };
}

const SYSTEM_KEY = 'mail_system_user';

async function systemSender() {
  const User = require('../models/User');
  const doc = await Setting.findOne({ key: SYSTEM_KEY }).lean();
  if (doc && doc.value) {
    const s = await senderFor(doc.value);
    if (!s.error) return s;
  }
  const admins = await User.find({ role: 'admin', subAdmin: { $ne: true }, active: true }).select('_id').lean();
  for (const a of admins) {
    const s = await senderFor(a._id);
    if (!s.error && s.own) return s;
  }
  const server = await getServer();
  if (server && server.source === 'env' && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return { server, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM || process.env.SMTP_USER };
  }
  return { error: 'No mailbox is set up for system emails' };
}

async function setSystemSender(userId) {
  await Setting.findOneAndUpdate({ key: SYSTEM_KEY }, { $set: { value: userId ? String(userId) : null } }, { upsert: true });
}

async function getSystemSenderId() {
  const doc = await Setting.findOne({ key: SYSTEM_KEY }).lean();
  return doc && doc.value ? String(doc.value) : null;
}

module.exports = { canReceive, getServer, saveServer, verifyAccount, senderFor, openSender, systemSender, setSystemSender, getSystemSenderId };
