function clean(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = clean(value[i]);
    return value;
  }
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete value[key];
      } else {
        value[key] = clean(value[key]);
      }
    }
  }
  return value;
}

module.exports = function sanitize(req, res, next) {
  if (req.body) clean(req.body);
  if (req.query) clean(req.query);
  if (req.params) clean(req.params);
  next();
};
