// Session cache with simple version-based invalidation.
// - Stores JSON in sessionStorage (per-tab session).
// - Provides a small in-memory layer to avoid repeated JSON parse.
// - Supports "domain versions" so any mutation can invalidate dependent caches.

const STORAGE_PREFIX = 'waraqa:sessioncache:';
const VERSION_PREFIX = `${STORAGE_PREFIX}v:`;

const memory = new Map();

const safeNow = () => Date.now();

const safeJsonParse = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

const safeJsonStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return null;
  }
};

const hasSessionStorage = () => {
  try {
    return typeof window !== 'undefined' && !!window.sessionStorage;
  } catch (e) {
    return false;
  }
};

const stableStringify = (value) => {
  // Minimal stable stringify for plain objects.
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return safeJsonStringify(value);
  }

  const keys = Object.keys(value).sort();
  const sorted = {};
  for (const key of keys) {
    sorted[key] = value[key];
  }
  return safeJsonStringify(sorted);
};

export const getDomainVersion = (domain) => {
  if (!hasSessionStorage()) return 0;
  const raw = sessionStorage.getItem(`${VERSION_PREFIX}${domain}`);
  const parsed = Number(raw || '0');
  return Number.isFinite(parsed) ? parsed : 0;
};

export const bumpDomainVersion = (domain) => {
  if (!hasSessionStorage()) return;
  const next = getDomainVersion(domain) + 1;
  sessionStorage.setItem(`${VERSION_PREFIX}${domain}`, String(next));
};

export const makeCacheKey = (scope, userId, params) => {
  const scopedUser = userId ? String(userId) : 'anon';
  const paramString = stableStringify(params) || '';
  return `${STORAGE_PREFIX}${scopedUser}:${scope}:${paramString}`;
};

export const readCache = (key, { deps = [] } = {}) => {
  const now = safeNow();

  const mem = memory.get(key);
  if (mem) {
    const { entry } = mem;
    if (entry && typeof entry === 'object') {
      const expired = entry.ttlMs ? (now - entry.createdAt) > entry.ttlMs : false;
      if (!expired) {
        const versions = entry.versions || {};
        const invalidated = deps.some((d) => (versions[d] ?? 0) !== getDomainVersion(d));
        if (!invalidated) {
          return { hit: true, value: entry.value, ageMs: now - entry.createdAt };
        }
      }
    }

    memory.delete(key);
  }

  if (!hasSessionStorage()) return { hit: false, value: null, ageMs: 0 };

  const raw = sessionStorage.getItem(key);
  const entry = safeJsonParse(raw);
  if (!entry || typeof entry !== 'object') return { hit: false, value: null, ageMs: 0 };

  const expired = entry.ttlMs ? (now - entry.createdAt) > entry.ttlMs : false;
  if (expired) {
    try { sessionStorage.removeItem(key); } catch (e) {}
    return { hit: false, value: null, ageMs: 0 };
  }

  const versions = entry.versions || {};
  const invalidated = deps.some((d) => (versions[d] ?? 0) !== getDomainVersion(d));
  if (invalidated) {
    try { sessionStorage.removeItem(key); } catch (e) {}
    return { hit: false, value: null, ageMs: 0 };
  }

  memory.set(key, { entry });
  return { hit: true, value: entry.value, ageMs: now - entry.createdAt };
};

export const writeCache = (key, value, { ttlMs = 0, deps = [] } = {}) => {
  const createdAt = safeNow();
  const versions = {};
  for (const dep of deps) {
    versions[dep] = getDomainVersion(dep);
  }

  const entry = {
    createdAt,
    ttlMs: Number(ttlMs) > 0 ? Number(ttlMs) : 0,
    versions,
    value,
  };

  memory.set(key, { entry });

  if (!hasSessionStorage()) return;

  const serialized = safeJsonStringify(entry);
  if (!serialized) return;

  try {
    sessionStorage.setItem(key, serialized);
  } catch (e) {
    // Storage can be full; best-effort only.
  }
};

export const removeCache = (key) => {
  memory.delete(key);
  if (!hasSessionStorage()) return;
  try {
    sessionStorage.removeItem(key);
  } catch (e) {}
};

export const clearAllCache = () => {
  memory.clear();
  if (!hasSessionStorage()) return;

  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch (e) {
    // ignore
  }
};
