let Redis;
try {
  // require optional dependency
  // eslint-disable-next-line global-require
  Redis = require('ioredis');
} catch (e) {
  Redis = null;
}

// Try to create a Redis client. If Redis package or connection isn't available, we'll fall back to an in-memory cache.
let redis;
let redisAvailable = false;
if (Redis) {
  try {
    redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
    // lightweight ping to verify availability (non-blocking)
    redis.ping().then(() => { redisAvailable = true; }).catch(() => { redisAvailable = false; });
  } catch (e) {
    redis = null;
    redisAvailable = false;
  }
} else {
  redis = null;
  redisAvailable = false;
}

// In-memory fallback cache
const memoryCache = new Map();

const set = async (key, value, ttlSeconds = 1800) => {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  if (redis && redisAvailable) {
    try {
      await redis.set(key, payload, 'EX', ttlSeconds);
      return true;
    } catch (e) {
      // fallback to memory
    }
  }
  const expiresAt = Date.now() + ttlSeconds * 1000;
  memoryCache.set(key, { payload, expiresAt });
  return true;
};

const get = async (key) => {
  if (redis && redisAvailable) {
    try {
      const v = await redis.get(key);
      return v;
    } catch (e) {
      // fallback
    }
  }
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) { memoryCache.delete(key); return null; }
  return entry.payload;
};

const del = async (key) => {
  if (redis && redisAvailable) {
    try { await redis.del(key); return true; } catch (e) {}
  }
  memoryCache.delete(key);
  return true;
};

module.exports = { redis, redisAvailable: () => redisAvailable, set, get, del };
