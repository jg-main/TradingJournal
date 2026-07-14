/**
 * token-encryption.test.ts
 *
 * Comprehensive tests for the AES-256-GCM token encryption module.
 *
 * Verifies encrypt/decrypt roundtrip, key validation, tamper detection,
 * and serialization/deserialization helpers.
 *
 * All tests use an explicit key so no ENCRYPTION_KEY env var is required.
 * Run: npx vitest run src/lib/__tests__/token-encryption.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptToken,
  decryptToken,
  validateEncryptionKey,
  getEncryptionKey,
  serializeEncryptedData,
  deserializeEncryptedData,
  EncryptedData,
} from '../token-encryption';

// ── Test Fixtures ──────────────────────────────────────────────────────

/** 64-character hex string = 32 bytes = 256 bits */
const VALID_HEX_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

/** A second valid key for cross-key tests */
const DIFFERENT_HEX_KEY = 'f0e1d2c3b4a5f6e7d8c9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1';

/** Sample plaintext values representing OAuth tokens */
const ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.example-access-token-payload';
const REFRESH_TOKEN = 'example-refresh-token-value-abcdef123456';
const EMPTY_STRING = '';
const UNICODE_TEXT = 'ñöü café 秘密 🔑';

describe('validateEncryptionKey', () => {
  it('returns a Buffer for a valid 64-character hex key', () => {
    const buf = validateEncryptionKey(VALID_HEX_KEY);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  it('throws for a key that is too short', () => {
    expect(() => validateEncryptionKey('abcd')).toThrow('expected 64 hex characters');
  });

  it('throws for a key that is too long', () => {
    expect(() => validateEncryptionKey(VALID_HEX_KEY + 'ff')).toThrow('expected 64 hex characters');
  });

  it('throws for a key with non-hex characters', () => {
    expect(() => validateEncryptionKey('z' + VALID_HEX_KEY.slice(1))).toThrow('must be a hexadecimal string');
  });

  it('throws for an empty string', () => {
    expect(() => validateEncryptionKey('')).toThrow('expected 64 hex characters');
  });
});

describe('getEncryptionKey', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('reads ENCRYPTION_KEY from env and returns a valid Buffer', () => {
    process.env.ENCRYPTION_KEY = VALID_HEX_KEY;
    const buf = getEncryptionKey();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
  });

  it('throws when ENCRYPTION_KEY env var is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => getEncryptionKey()).toThrow('Missing ENCRYPTION_KEY');
  });

  it('throws when ENCRYPTION_KEY env var is empty string', () => {
    process.env.ENCRYPTION_KEY = '';
    expect(() => getEncryptionKey()).toThrow('Missing ENCRYPTION_KEY');
  });

  it('throws when ENCRYPTION_KEY env var has invalid format', () => {
    process.env.ENCRYPTION_KEY = 'not-a-valid-hex-key';
    expect(() => getEncryptionKey()).toThrow('expected 64 hex characters');
  });
});

// ── encryptToken / decryptToken Roundtrip ──────────────────────────────

describe('encryptToken / decryptToken roundtrip', () => {
  it('encrypts and decrypts an access token', () => {
    const encrypted = encryptToken(ACCESS_TOKEN, validateEncryptionKey(VALID_HEX_KEY));
    const decrypted = decryptToken(encrypted, validateEncryptionKey(VALID_HEX_KEY));
    expect(decrypted).toBe(ACCESS_TOKEN);
  });

  it('encrypts and decrypts a refresh token', () => {
    const encrypted = encryptToken(REFRESH_TOKEN, validateEncryptionKey(VALID_HEX_KEY));
    const decrypted = decryptToken(encrypted, validateEncryptionKey(VALID_HEX_KEY));
    expect(decrypted).toBe(REFRESH_TOKEN);
  });

  it('encrypts and decrypts an empty string', () => {
    const encrypted = encryptToken(EMPTY_STRING, validateEncryptionKey(VALID_HEX_KEY));
    const decrypted = decryptToken(encrypted, validateEncryptionKey(VALID_HEX_KEY));
    expect(decrypted).toBe(EMPTY_STRING);
  });

  it('encrypts and decrypts unicode/emoji text', () => {
    const encrypted = encryptToken(UNICODE_TEXT, validateEncryptionKey(VALID_HEX_KEY));
    const decrypted = decryptToken(encrypted, validateEncryptionKey(VALID_HEX_KEY));
    expect(decrypted).toBe(UNICODE_TEXT);
  });

  it('produces unique ciphertexts for the same plaintext (random IV)', () => {
    const keyBuf = validateEncryptionKey(VALID_HEX_KEY);
    const result1 = encryptToken(ACCESS_TOKEN, keyBuf);
    const result2 = encryptToken(ACCESS_TOKEN, keyBuf);

    // IVs should differ (random)
    expect(result1.iv).not.toBe(result2.iv);
    // Ciphertexts should differ because IVs differ
    expect(result1.ciphertext).not.toBe(result2.ciphertext);
  });

  it('returns EncryptedData with non-empty hex fields', () => {
    const encrypted = encryptToken(ACCESS_TOKEN, validateEncryptionKey(VALID_HEX_KEY));
    expect(encrypted.iv).toMatch(/^[0-9a-f]+$/);
    expect(encrypted.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(encrypted.authTag).toMatch(/^[0-9a-f]+$/);
    expect(encrypted.iv.length).toBe(24); // 12 bytes → 24 hex chars
    expect(encrypted.authTag.length).toBe(32); // 16 bytes → 32 hex chars
  });
});

// ── Tamper Detection ─────────────────────────────────────────────────────

describe('tamper detection', () => {
  it('throws when decrypting with a different key', () => {
    const key1 = validateEncryptionKey(VALID_HEX_KEY);
    const key2 = validateEncryptionKey(DIFFERENT_HEX_KEY);

    const encrypted = encryptToken(ACCESS_TOKEN, key1);
    expect(() => decryptToken(encrypted, key2)).toThrow();
  });

  it('throws when the auth tag is modified', () => {
    const key = validateEncryptionKey(VALID_HEX_KEY);
    const encrypted = encryptToken(ACCESS_TOKEN, key);

    const tampered: EncryptedData = {
      ...encrypted,
      authTag: encrypted.authTag.replace(/[0-9a-f]$/, '0'),
    };
    expect(() => decryptToken(tampered, key)).toThrow();
  });

  it('throws when the ciphertext is modified', () => {
    const key = validateEncryptionKey(VALID_HEX_KEY);
    const encrypted = encryptToken(ACCESS_TOKEN, key);

    const tampered: EncryptedData = {
      ...encrypted,
      ciphertext: encrypted.ciphertext + '00',
    };
    expect(() => decryptToken(tampered, key)).toThrow();
  });

  it('throws when the IV is modified', () => {
    const key = validateEncryptionKey(VALID_HEX_KEY);
    const encrypted = encryptToken(ACCESS_TOKEN, key);

    const tampered: EncryptedData = {
      ...encrypted,
      iv: encrypted.iv.replace(/^../, '00'),
    };
    expect(() => decryptToken(tampered, key)).toThrow();
  });
});

// ── Serialization ────────────────────────────────────────────────────────

describe('serializeEncryptedData / deserializeEncryptedData', () => {
  it('roundtrips EncryptedData through JSON', () => {
    const key = validateEncryptionKey(VALID_HEX_KEY);
    const encrypted = encryptToken(ACCESS_TOKEN, key);

    const json = serializeEncryptedData(encrypted);
    const deserialized = deserializeEncryptedData(json);

    expect(deserialized.iv).toBe(encrypted.iv);
    expect(deserialized.ciphertext).toBe(encrypted.ciphertext);
    expect(deserialized.authTag).toBe(encrypted.authTag);
  });

  it('produces valid JSON', () => {
    const key = validateEncryptionKey(VALID_HEX_KEY);
    const encrypted = encryptToken(ACCESS_TOKEN, key);

    const json = serializeEncryptedData(encrypted);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('ciphertext');
    expect(parsed).toHaveProperty('authTag');
  });

  it('throws for deserializing malformed JSON', () => {
    expect(() => deserializeEncryptedData('{not json}')).toThrow();
  });

  it('throws for deserializing JSON with missing fields', () => {
    expect(() => deserializeEncryptedData('{"iv":"00"}')).toThrow(
      'Invalid encrypted data format',
    );
  });

  it('throws for deserializing JSON with non-string fields', () => {
    expect(() =>
      deserializeEncryptedData(
        '{"iv":"00","ciphertext":123,"authTag":"00"}',
      ),
    ).toThrow('Invalid encrypted data format');
  });
});

// ── Integration: Encrypt → Serialize → Store → Retrieve → Deserialize → Decrypt ──

describe('full storage roundtrip', () => {
  it('simulates storing and retrieving encrypted tokens via JSON', () => {
    const key = validateEncryptionKey(VALID_HEX_KEY);

    // Simulate storing
    const encryptedAccess = encryptToken(ACCESS_TOKEN, key);
    const encryptedRefresh = encryptToken(REFRESH_TOKEN, key);
    const accessJson = serializeEncryptedData(encryptedAccess);
    const refreshJson = serializeEncryptedData(encryptedRefresh);

    // Simulate retrieving (e.g. from DB TEXT column)
    const retrievedAccess = deserializeEncryptedData(accessJson);
    const retrievedRefresh = deserializeEncryptedData(refreshJson);

    const decryptedAccess = decryptToken(retrievedAccess, key);
    const decryptedRefresh = decryptToken(retrievedRefresh, key);

    expect(decryptedAccess).toBe(ACCESS_TOKEN);
    expect(decryptedRefresh).toBe(REFRESH_TOKEN);
  });

  it('stored encrypted data survives JSON roundtrip', () => {
    const key = validateEncryptionKey(VALID_HEX_KEY);
    const original = encryptToken(ACCESS_TOKEN, key);

    // JSON.stringify → parse
    const roundtrippedJson = JSON.parse(JSON.stringify(original));
    const decrypted = decryptToken(roundtrippedJson, key);
    expect(decrypted).toBe(ACCESS_TOKEN);
  });
});
