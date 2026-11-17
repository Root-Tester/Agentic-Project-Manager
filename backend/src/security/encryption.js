import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag
const KEY_LENGTH = 32; // 256-bit encryption key

/**
 * Derives a 256-bit key from a passphrase/master secret and salt.
 * @param {string} masterSecret - Base secret (e.g. APM_JWT_SECRET).
 * @param {string|Buffer} [salt='apm-aes-encryption-salt-v1'] - Salt string or buffer.
 * @returns {Buffer} 32-byte key buffer.
 */
export function deriveKey(masterSecret, salt = 'apm-aes-encryption-salt-v1') {
  if (typeof masterSecret !== 'string' || !masterSecret.trim()) {
    throw new Error('Encryption master secret must be a non-empty string.');
  }
  return scryptSync(masterSecret, salt, KEY_LENGTH);
}

/**
 * Encrypts data using AES-256-GCM.
 *
 * @param {string|Buffer|object} plaintext - Data to encrypt.
 * @param {string|Buffer} secret - Master secret string or 32-byte key buffer.
 * @returns {string} Formatted ciphertext: enc$v1$<iv_base64url>$<tag_base64url>$<ciphertext_base64url>
 */
export function encryptData(plaintext, secret) {
  if (plaintext == null) return '';
  const key = Buffer.isBuffer(secret) && secret.length === KEY_LENGTH
    ? secret
    : deriveKey(typeof secret === 'string' ? secret : String(secret));

  const textToEncrypt = typeof plaintext === 'object' && !Buffer.isBuffer(plaintext)
    ? JSON.stringify(plaintext)
    : String(plaintext);

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const inputBuffer = Buffer.from(textToEncrypt, 'utf8');
  const ciphertext = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc$v1$${iv.toString('base64url')}$${tag.toString('base64url')}$${ciphertext.toString('base64url')}`;
}

/**
 * Decrypts a payload previously encrypted with encryptData.
 *
 * @param {string} encryptedString - Formatted ciphertext.
 * @param {string|Buffer} secret - Master secret string or 32-byte key buffer.
 * @returns {string} Decrypted plaintext string.
 */
export function decryptData(encryptedString, secret) {
  if (typeof encryptedString !== 'string' || !encryptedString.trim()) {
    throw new Error('Encrypted payload must be a non-empty string.');
  }

  const parts = encryptedString.split('$');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Unrecognized encryption payload format.');
  }

  const [, , ivBase64, tagBase64, ciphertextBase64] = parts;
  const iv = Buffer.from(ivBase64, 'base64url');
  const tag = Buffer.from(tagBase64, 'base64url');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64url');

  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid encryption payload metadata length.');
  }

  const key = Buffer.isBuffer(secret) && secret.length === KEY_LENGTH
    ? secret
    : deriveKey(typeof secret === 'string' ? secret : String(secret));

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Data decryption failed: integrity check failed or invalid key.');
  }
}

/**
 * Masks sensitive strings (e.g. API keys or tokens) for safe logging.
 * @param {string} value
 * @returns {string}
 */
export function maskSensitive(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}
