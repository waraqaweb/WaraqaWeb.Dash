/**
 * AES-256-GCM encryption for SMTP password storage.
 * The key is read from EMAIL_ENCRYPTION_KEY env var (32 hex chars = 16 bytes, or 64 hex = 32 bytes).
 * Falls back to env-var plaintext if no key is configured (dev mode).
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32; // bytes

function getKey() {
  const raw = process.env.EMAIL_ENCRYPTION_KEY;
  if (!raw) return null;
  // Accept hex-encoded key (64 chars = 32 bytes) or base64 (44 chars = 32 bytes)
  try {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    if (buf.length !== KEY_LEN) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Encrypt a plaintext SMTP password.
 * Returns a prefixed string: "enc:iv:tag:ciphertext" (all hex).
 * If no key configured, returns the plaintext as-is (prefixed "plain:").
 */
function encryptSMTPPass(plaintext) {
  if (!plaintext) return plaintext;
  const key = getKey();
  if (!key) return `plain:${plaintext}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an SMTP password that was encrypted by encryptSMTPPass.
 * Returns the original plaintext.
 * If the value is not encrypted (no "enc:" prefix), returns it as-is.
 */
function decryptSMTPPass(stored) {
  if (!stored) return stored;
  if (stored.startsWith('plain:')) return stored.slice(6);
  if (!stored.startsWith('enc:')) return stored; // legacy plaintext
  const key = getKey();
  if (!key) {
    console.warn('[emailCrypto] EMAIL_ENCRYPTION_KEY not set; cannot decrypt stored SMTP password');
    return '';
  }
  try {
    const parts = stored.slice(4).split(':');
    if (parts.length !== 3) throw new Error('Invalid format');
    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[emailCrypto] Decryption failed:', e.message);
    return '';
  }
}

module.exports = { encryptSMTPPass, decryptSMTPPass };
