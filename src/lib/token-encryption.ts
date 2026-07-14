/**
 * token-encryption.ts
 *
 * AES-256-GCM encryption/decryption for OAuth tokens stored at rest.
 *
 * Pure functions with zero database or framework dependencies.
 *
 * ## Security Properties
 * - AES-256-GCM provides authenticated encryption (confidentiality + integrity).
 * - Each encryption generates a fresh random 12-byte IV (never reused).
 * - Auth tag (16 bytes) is verified on decryption — tampering is detected.
 * - ENCRYPTION_KEY must be a 64-character hex string (32 bytes / 256 bits).
 *
 * ## Key Management
 * - ENCRYPTION_KEY is read from process.env at call time.
 * - Key rotation is NOT supported — changing the key invalidates all stored tokens.
 * - For local-first apps this is acceptable; document the tradeoff.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// ── Constants ──────────────────────────────────────────────────────────

/** AES-256-GCM key length: 32 bytes = 256 bits */
const KEY_BYTE_LENGTH = 32;

/** GCM standard IV length: 12 bytes (96 bits) */
const IV_LENGTH = 12;

/** GCM standard auth tag length: 16 bytes (128 bits) */
const AUTH_TAG_LENGTH = 16;

/** Algorithm identifier */
const ALGORITHM = 'aes-256-gcm';

/** Env var name for the encryption key */
const ENCRYPTION_KEY_ENV = 'ENCRYPTION_KEY';

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Encrypted token payload.
 *
 * All fields are hex-encoded strings for JSON-safe storage.
 * In the database these are stored inside a JSON blob column.
 */
export interface EncryptedData {
  /** Hex-encoded 12-byte IV */
  iv: string;
  /** Hex-encoded ciphertext */
  ciphertext: string;
  /** Hex-encoded 16-byte GCM auth tag */
  authTag: string;
}

// ── Key Management ─────────────────────────────────────────────────────

/**
 * Read and validate the ENCRYPTION_KEY from the environment.
 *
 * @returns A 32-byte Buffer suitable for AES-256.
 * @throws If the key is missing, not hex, or not exactly 64 hex chars.
 */
export function getEncryptionKey(): Buffer {
  const keyRaw = process.env[ENCRYPTION_KEY_ENV];

  if (!keyRaw) {
    throw new Error(
      `Missing ${ENCRYPTION_KEY_ENV} environment variable. ` +
        'Set it to a 64-character hex string (32 bytes) for AES-256-GCM encryption.',
    );
  }

  return validateEncryptionKey(keyRaw);
}

/**
 * Validate an encryption key string.
 *
 * @param key - The hex-encoded 256-bit key to validate.
 * @returns A 32-byte Buffer.
 * @throws If the key is not a 64-character hex string.
 */
export function validateEncryptionKey(key: string): Buffer {
  if (key.length !== KEY_BYTE_LENGTH * 2) {
    throw new Error(
      `Invalid ENCRYPTION_KEY: expected ${KEY_BYTE_LENGTH * 2} hex characters ` +
        `(${KEY_BYTE_LENGTH} bytes), got ${key.length} characters.`,
    );
  }

  const hexRegex = /^[0-9a-fA-F]+$/;
  if (!hexRegex.test(key)) {
    throw new Error(
      'Invalid ENCRYPTION_KEY: must be a hexadecimal string (0-9, a-f, A-F).',
    );
  }

  return Buffer.from(key, 'hex');
}

// ── Encryption / Decryption ────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Generates a fresh random IV on every call. The returned EncryptedData
 * contains hex-encoded iv, ciphertext, and authTag.
 *
 * @param plaintext - The string to encrypt (UTF-8).
 * @param key - Optional 32-byte key Buffer. Reads from ENCRYPTION_KEY if omitted.
 * @returns EncryptedData with hex-encoded fields.
 * @throws If key is invalid or encryption fails.
 */
export function encryptToken(
  plaintext: string,
  key?: Buffer,
): EncryptedData {
  const encryptionKey = key ?? getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt an EncryptedData payload using AES-256-GCM.
 *
 * Verifies the auth tag — tampered data throws an error.
 *
 * @param data - EncryptedData with hex-encoded iv, ciphertext, and authTag.
 * @param key - Optional 32-byte key Buffer. Reads from ENCRYPTION_KEY if omitted.
 * @returns The decrypted plaintext string (UTF-8).
 * @throws If the auth tag is invalid (data tampered), key is wrong, or format is bad.
 */
export function decryptToken(
  data: EncryptedData,
  key?: Buffer,
): string {
  const encryptionKey = key ?? getEncryptionKey();

  const iv = Buffer.from(data.iv, 'hex');
  const ciphertext = Buffer.from(data.ciphertext, 'hex');
  const authTag = Buffer.from(data.authTag, 'hex');

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}

/**
 * Convenience: serialize an EncryptedData object to a JSON string
 * suitable for storage in a TEXT column.
 */
export function serializeEncryptedData(data: EncryptedData): string {
  return JSON.stringify(data);
}

/**
 * Convenience: deserialize a JSON string back to an EncryptedData object.
 */
export function deserializeEncryptedData(json: string): EncryptedData {
  const parsed = JSON.parse(json) as EncryptedData;

  if (
    typeof parsed.iv !== 'string' ||
    typeof parsed.ciphertext !== 'string' ||
    typeof parsed.authTag !== 'string'
  ) {
    throw new Error(
      'Invalid encrypted data format: expected { iv, ciphertext, authTag } with string values.',
    );
  }

  return parsed;
}
