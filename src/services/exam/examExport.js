// CSV with protection against spreadsheet formula injection (cells that start
// with = + - @ are prefixed with an apostrophe).
exports.csv = (rows, headers) => {
  const cols = headers || Object.keys(rows[0] || {});
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
};
