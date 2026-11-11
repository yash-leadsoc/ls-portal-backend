/**
 * Minimal in-process TTL cache with a hard size cap (oldest-inserted evicted
 * first). Deliberately tiny: it exists to shave database reads off hot exam
 * endpoints (a single API container), never as a source of truth.
 */
class TtlCache {
  constructor({ ttlMs = 5000, max = 2000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, exp: this.now() + ttlMs });
    return value;
  }

  delete(key) {
    return this.map.delete(key);
  }

  deleteWhere(pred) {
    for (const k of this.map.keys()) if (pred(k)) this.map.delete(k);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

module.exports = TtlCache;
