const crypto = require('crypto');

function key() {
  const raw = process.env.PASSWORD_VIEW_KEY || '';
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : crypto.createHash('sha256').update(raw).digest();
  return buf.length === 32 ? buf : null;
}

function encrypt(plain) {
  const k = key();
  if (!k || plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

function decrypt(box) {
  const k = key();
  if (!k || !box) return null;
  try {
    const [iv, tag, data] = String(box).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { encrypt, decrypt, enabled: () => !!key() };
