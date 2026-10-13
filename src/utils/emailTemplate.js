const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function publicUrl() {
  const fromEnv = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const cors = String(process.env.CORS_ORIGIN || '').split(',')[0].trim().replace(/\/+$/, '');
  return /^https:\/\//.test(cors) ? cors : 'https://tedp.leadsoc.com';
}

function logoUrl() {
  return process.env.EMAIL_LOGO_URL || `${publicUrl()}/logo-full.png?v=1`;
}

function emailLayout({ bodyHtml, footerHtml = '', preheader = '' }) {
  const site = publicUrl();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>LeadSoC TEDP</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6fb;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e9f2;">
        <tr>
          <td style="background:#1b2b5e;padding:18px 24px;">
            <img src="${esc(logoUrl())}" width="170" alt="LeadSoC" style="display:block;width:170px;height:auto;border:0;outline:none;text-decoration:none;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#b9c3e3;margin-top:8px;">Talent Enablement &amp; Deployment Platform</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#64748b;border-top:1px solid #eef1f6;">
            ${footerHtml ? `${footerHtml}<br>` : ''}
            <a href="${esc(site)}" style="color:#0284a8;text-decoration:none;">${esc(site.replace(/^https?:\/\//, ''))}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

module.exports = { emailLayout, logoUrl, publicUrl, esc };
