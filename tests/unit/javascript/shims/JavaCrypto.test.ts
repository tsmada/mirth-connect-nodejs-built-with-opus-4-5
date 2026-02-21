/**
 * Tests for Java Crypto Shims
 *
 * Validates that the Node.js implementations of Java crypto classes
 * (MessageDigest, Base64, Cipher, Mac, SecretKeySpec, IvParameterSpec,
 * SecureRandom, KeyGenerator) behave correctly for real-world Mirth usage.
 *
 * Known-answer vectors sourced from:
 *   - NIST FIPS 180-4 (SHA-256)
 *   - RFC 4231 (HMAC-SHA256 test vectors)
 *   - RFC 4648 (Base64)
 */

import {
  JavaMessageDigest,
  JavaBase64,
  JavaCipher,
  JavaSecretKeySpec,
  JavaIvParameterSpec,
  JavaMac,
  JavaSecureRandom,
  JavaKeyGenerator,
  ENCRYPT_MODE,
  DECRYPT_MODE,
} from '../../../../src/javascript/shims/JavaCrypto.js';
import * as crypto from 'crypto';

// -------------------------------------------------------------------------
// MessageDigest
// -------------------------------------------------------------------------
describe('JavaMessageDigest', () => {
  it('should compute SHA-256 hash of empty string', () => {
    const md = JavaMessageDigest.getInstance('SHA-256');
    const hash = md.digest(Buffer.from(''));
    expect(hash.toString('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('should compute SHA-256 hash of "abc"', () => {
    const md = JavaMessageDigest.getInstance('SHA-256');
    const hash = md.digest('abc');
    expect(hash.toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('should compute SHA-1 hash', () => {
    const md = JavaMessageDigest.getInstance('SHA-1');
    const hash = md.digest('abc');
    expect(hash.toString('hex')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('should compute MD5 hash', () => {
    const md = JavaMessageDigest.getInstance('MD5');
    const hash = md.digest('hello');
    expect(hash.toString('hex')).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('should compute SHA-512 hash', () => {
    const md = JavaMessageDigest.getInstance('SHA-512');
    const hash = md.digest('abc');
    // NIST known-answer
    expect(hash.toString('hex')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
      '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
    );
  });

  it('should support chained update() calls', () => {
    const md = JavaMessageDigest.getInstance('SHA-256');
    md.update('he');
    md.update('llo');
    const hash = md.digest();
    // Same as SHA-256("hello")
    expect(hash.toString('hex')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('should reset after digest()', () => {
    const md = JavaMessageDigest.getInstance('SHA-256');
    md.digest('first');
    const hash2 = md.digest('abc');
    expect(hash2.toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('should support explicit reset()', () => {
    const md = JavaMessageDigest.getInstance('SHA-256');
    md.update('partial');
    md.reset();
    const hash = md.digest('abc');
    expect(hash.toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('should accept Buffer input', () => {
    const md = JavaMessageDigest.getInstance('SHA-256');
    const hash = md.digest(Buffer.from([0x61, 0x62, 0x63])); // "abc"
    expect(hash.toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('should support digest(data) overload', () => {
    const md = JavaMessageDigest.getInstance('SHA-256');
    md.update('ab');
    const hash = md.digest('c'); // update("ab") + digest("c") = SHA-256("abc")
    expect(hash.toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('should throw for invalid algorithm', () => {
    expect(() => JavaMessageDigest.getInstance('SHA-999')).toThrow('NoSuchAlgorithmException');
  });

  it('should compute SHA-384 hash', () => {
    const md = JavaMessageDigest.getInstance('SHA-384');
    const hash = md.digest('abc');
    expect(hash.length).toBe(48);
  });
});

// -------------------------------------------------------------------------
// Base64
// -------------------------------------------------------------------------
describe('JavaBase64', () => {
  it('should encode/decode round-trip', () => {
    const encoder = JavaBase64.getEncoder();
    const decoder = JavaBase64.getDecoder();
    const original = Buffer.from('Hello, World!');
    const encoded = encoder.encodeToString(original);
    expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
    const decoded = decoder.decode(encoded);
    expect(decoded.toString()).toBe('Hello, World!');
  });

  it('should encode to Buffer', () => {
    const encoder = JavaBase64.getEncoder();
    const result = encoder.encode(Buffer.from('ABC'));
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString('ascii')).toBe('QUJD');
  });

  it('should handle empty input', () => {
    const encoder = JavaBase64.getEncoder();
    const decoder = JavaBase64.getDecoder();
    expect(encoder.encodeToString(Buffer.alloc(0))).toBe('');
    expect(decoder.decode('').length).toBe(0);
  });

  it('should handle binary data', () => {
    const encoder = JavaBase64.getEncoder();
    const decoder = JavaBase64.getDecoder();
    const binary = Buffer.from([0x00, 0xff, 0x80, 0x7f, 0x01]);
    const decoded = decoder.decode(encoder.encodeToString(binary));
    expect(decoded).toEqual(binary);
  });

  it('should produce MIME-encoded output with line breaks', () => {
    const encoder = JavaBase64.getMimeEncoder();
    const longInput = Buffer.from('A'.repeat(100));
    const encoded = encoder.encodeToString(longInput);
    const lines = encoded.split('\r\n');
    // First line should be 76 chars
    expect(lines[0]!.length).toBe(76);
  });

  it('should decode MIME-encoded input', () => {
    const mimeDecoder = JavaBase64.getMimeDecoder();
    const mimeEncoded = 'SGVs\r\nbG8s\r\nIFdv\r\ncmxk\r\nIQ==';
    const decoded = mimeDecoder.decode(mimeEncoded);
    expect(decoded.toString()).toBe('Hello, World!');
  });

  it('should produce URL-safe encoding (no + or /)', () => {
    const encoder = JavaBase64.getUrlEncoder();
    // Create data that would normally produce + and /
    const data = Buffer.from([0xfb, 0xff, 0xfe]);
    const encoded = encoder.encodeToString(data);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('should decode URL-safe encoding', () => {
    const encoder = JavaBase64.getUrlEncoder();
    const decoder = JavaBase64.getUrlDecoder();
    const data = Buffer.from([0xfb, 0xff, 0xfe]);
    const encoded = encoder.encodeToString(data);
    const decoded = decoder.decode(encoded);
    expect(decoded).toEqual(data);
  });

  it('should handle Buffer input for decode', () => {
    const decoder = JavaBase64.getDecoder();
    const result = decoder.decode(Buffer.from('QUJD', 'ascii'));
    expect(result.toString()).toBe('ABC');
  });

  it('should handle padding-less URL encoding round-trip', () => {
    const encoder = JavaBase64.getUrlEncoder();
    const decoder = JavaBase64.getUrlDecoder();
    // 1-byte input produces 2 base64 chars + 2 padding chars in standard
    const data = Buffer.from([0x41]);
    const encoded = encoder.encodeToString(data);
    expect(encoded).toBe('QQ'); // No padding
    const decoded = decoder.decode(encoded);
    expect(decoded).toEqual(data);
  });
});

// -------------------------------------------------------------------------
// SecretKeySpec
// -------------------------------------------------------------------------
describe('JavaSecretKeySpec', () => {
  it('should store and return key bytes', () => {
    const key = Buffer.from('0123456789abcdef');
    const spec = new JavaSecretKeySpec(key, 'AES');
    expect(spec.getEncoded()).toEqual(key);
  });

  it('should return the algorithm', () => {
    const spec = new JavaSecretKeySpec(Buffer.alloc(16), 'AES');
    expect(spec.getAlgorithm()).toBe('AES');
  });

  it('should return a copy of key bytes (defensive copy)', () => {
    const key = Buffer.from('0123456789abcdef');
    const spec = new JavaSecretKeySpec(key, 'AES');
    const encoded = spec.getEncoded();
    encoded[0] = 0xff; // Mutate the returned copy
    expect(spec.getEncoded()[0]).not.toBe(0xff);
  });
});

// -------------------------------------------------------------------------
// IvParameterSpec
// -------------------------------------------------------------------------
describe('JavaIvParameterSpec', () => {
  it('should store and return IV bytes', () => {
    const iv = crypto.randomBytes(16);
    const spec = new JavaIvParameterSpec(iv);
    expect(spec.getIV()).toEqual(iv);
  });

  it('should return a defensive copy', () => {
    const iv = Buffer.alloc(16, 0x42);
    const spec = new JavaIvParameterSpec(iv);
    const returned = spec.getIV();
    returned[0] = 0xff;
    expect(spec.getIV()[0]).toBe(0x42);
  });
});

// -------------------------------------------------------------------------
// Cipher
// -------------------------------------------------------------------------
describe('JavaCipher', () => {
  const testKey128 = Buffer.alloc(16, 0x42); // 128-bit
  const testKey192 = Buffer.alloc(24, 0x42); // 192-bit
  const testKey256 = Buffer.alloc(32, 0x42); // 256-bit
  const testIv = Buffer.alloc(16, 0x00);

  it('should encrypt and decrypt AES/CBC/PKCS5Padding with 128-bit key', () => {
    const plaintext = 'Hello, World!';

    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const encrypted = cipher.doFinal(plaintext);

    const decipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted.toString('utf-8')).toBe(plaintext);
  });

  it('should encrypt and decrypt AES/CBC/PKCS5Padding with 192-bit key', () => {
    const plaintext = 'AES-192 test';

    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey192, 'AES'), new JavaIvParameterSpec(testIv));
    const encrypted = cipher.doFinal(plaintext);

    const decipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey192, 'AES'), new JavaIvParameterSpec(testIv));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted.toString('utf-8')).toBe(plaintext);
  });

  it('should encrypt and decrypt AES/CBC/PKCS5Padding with 256-bit key', () => {
    const plaintext = 'AES-256 encryption test with PKCS5 padding';

    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(testIv));
    const encrypted = cipher.doFinal(plaintext);

    const decipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(testIv));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted.toString('utf-8')).toBe(plaintext);
  });

  it('should handle AES/ECB/NoPadding', () => {
    // ECB NoPadding requires input to be exact block size (16 bytes)
    const plaintext = Buffer.from('0123456789abcdef'); // 16 bytes

    const cipher = JavaCipher.getInstance('AES/ECB/NoPadding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'));
    const encrypted = cipher.doFinal(plaintext);

    const decipher = JavaCipher.getInstance('AES/ECB/NoPadding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('should handle AES/GCM/NoPadding', () => {
    const plaintext = 'GCM authenticated encryption';
    const gcmIv = Buffer.alloc(12, 0x00); // GCM typically uses 12-byte IV

    const cipher = JavaCipher.getInstance('AES/GCM/NoPadding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(gcmIv));
    const encrypted = cipher.doFinal(plaintext);

    // Encrypted should be plaintext length + 16 bytes auth tag
    expect(encrypted.length).toBe(Buffer.byteLength(plaintext) + 16);

    const decipher = JavaCipher.getInstance('AES/GCM/NoPadding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(gcmIv));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted.toString('utf-8')).toBe(plaintext);
  });

  it('should support incremental update() + doFinal()', () => {
    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    cipher.update('Hello, ');
    const encrypted = cipher.doFinal('World!');

    const decipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted.toString('utf-8')).toBe('Hello, World!');
  });

  it('should produce deterministic output with same key/IV', () => {
    const c1 = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    c1.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const enc1 = c1.doFinal('test');

    const c2 = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    c2.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const enc2 = c2.doFinal('test');

    expect(enc1).toEqual(enc2);
  });

  it('should accept raw Buffer as key and IV', () => {
    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, testKey128 as unknown as JavaSecretKeySpec, testIv as unknown as JavaIvParameterSpec);
    const encrypted = cipher.doFinal('test');
    expect(encrypted.length).toBeGreaterThan(0);
  });

  it('should handle multi-block plaintext', () => {
    const plaintext = 'A'.repeat(1024); // 1KB, multiple AES blocks

    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(testIv));
    const encrypted = cipher.doFinal(plaintext);

    const decipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(testIv));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted.toString('utf-8')).toBe(plaintext);
  });

  it('should fail GCM decryption with wrong auth tag', () => {
    const gcmIv = Buffer.alloc(12, 0x00);
    const cipher = JavaCipher.getInstance('AES/GCM/NoPadding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(gcmIv));
    const encrypted = cipher.doFinal('secret');

    // Corrupt the auth tag (last 16 bytes)
    encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 0xff;

    const decipher = JavaCipher.getInstance('AES/GCM/NoPadding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(gcmIv));
    expect(() => decipher.doFinal(encrypted)).toThrow();
  });

  it('should handle CBC decryption with wrong key', () => {
    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const encrypted = cipher.doFinal('sensitive data');

    const wrongKey = Buffer.alloc(16, 0x99);
    const decipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(wrongKey, 'AES'), new JavaIvParameterSpec(testIv));
    // With PKCS5 padding and wrong key, final() typically throws due to bad padding
    expect(() => decipher.doFinal(encrypted)).toThrow();
  });

  it('should handle ECB with PKCS5Padding', () => {
    const plaintext = 'ECB padded test';

    const cipher = JavaCipher.getInstance('AES/ECB/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'));
    const encrypted = cipher.doFinal(plaintext);

    const decipher = JavaCipher.getInstance('AES/ECB/PKCS5Padding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted.toString('utf-8')).toBe(plaintext);
  });

  it('should handle empty plaintext with padding', () => {
    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const encrypted = cipher.doFinal(Buffer.alloc(0));

    const decipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');
    decipher.init(DECRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const decrypted = decipher.doFinal(encrypted);

    expect(decrypted.length).toBe(0);
  });

  it('should support re-init for multiple operations', () => {
    const cipher = JavaCipher.getInstance('AES/CBC/PKCS5Padding');

    // First operation
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey128, 'AES'), new JavaIvParameterSpec(testIv));
    const enc1 = cipher.doFinal('first');

    // Re-init for second operation
    cipher.init(ENCRYPT_MODE, new JavaSecretKeySpec(testKey256, 'AES'), new JavaIvParameterSpec(testIv));
    const enc2 = cipher.doFinal('second');

    // Different keys should produce different ciphertext (even for "first" vs "second")
    expect(enc1).not.toEqual(enc2);
  });
});

// -------------------------------------------------------------------------
// Mac
// -------------------------------------------------------------------------
describe('JavaMac', () => {
  it('should compute HmacSHA256', () => {
    const mac = JavaMac.getInstance('HmacSHA256');
    const key = new JavaSecretKeySpec(Buffer.from('secret-key'), 'HmacSHA256');
    mac.init(key);
    const result = mac.doFinal('Hello, World!');

    // Verify against Node.js crypto
    const expected = crypto.createHmac('sha256', 'secret-key')
      .update('Hello, World!').digest();
    expect(result).toEqual(expected);
  });

  it('should compute HmacSHA1', () => {
    const mac = JavaMac.getInstance('HmacSHA1');
    const key = new JavaSecretKeySpec(Buffer.from('key'), 'HmacSHA1');
    mac.init(key);
    const result = mac.doFinal('data');

    const expected = crypto.createHmac('sha1', 'key').update('data').digest();
    expect(result).toEqual(expected);
  });

  it('should compute HmacSHA512', () => {
    const mac = JavaMac.getInstance('HmacSHA512');
    const key = new JavaSecretKeySpec(Buffer.from('key'), 'HmacSHA512');
    mac.init(key);
    const result = mac.doFinal('data');
    expect(result.length).toBe(64); // SHA-512 = 64 bytes
  });

  it('should support chained update() calls', () => {
    const mac = JavaMac.getInstance('HmacSHA256');
    const key = new JavaSecretKeySpec(Buffer.from('key'), 'HmacSHA256');
    mac.init(key);
    mac.update('Hello');
    mac.update(', ');
    const result = mac.doFinal('World!');

    const expected = crypto.createHmac('sha256', 'key')
      .update('Hello, World!').digest();
    expect(result).toEqual(expected);
  });

  it('should support doFinal(data) overload', () => {
    const mac = JavaMac.getInstance('HmacSHA256');
    const key = new JavaSecretKeySpec(Buffer.from('key'), 'HmacSHA256');
    mac.init(key);
    const result = mac.doFinal('message');

    const expected = crypto.createHmac('sha256', 'key').update('message').digest();
    expect(result).toEqual(expected);
  });

  it('should reset after doFinal()', () => {
    const mac = JavaMac.getInstance('HmacSHA256');
    const key = new JavaSecretKeySpec(Buffer.from('key'), 'HmacSHA256');
    mac.init(key);
    mac.doFinal('first');

    // Second call should start fresh
    const result = mac.doFinal('message');
    const expected = crypto.createHmac('sha256', 'key').update('message').digest();
    expect(result).toEqual(expected);
  });

  it('should throw if not initialized', () => {
    const mac = JavaMac.getInstance('HmacSHA256');
    expect(() => mac.doFinal('data')).toThrow('Mac not initialized');
  });

  it('should throw for invalid algorithm', () => {
    expect(() => JavaMac.getInstance('HmacSHA999')).toThrow('NoSuchAlgorithmException');
  });

  // RFC 4231 Test Case 1: HMAC-SHA-256
  it('should match RFC 4231 test vector 1 (HmacSHA256)', () => {
    const key = Buffer.alloc(20, 0x0b);
    const data = 'Hi There';
    const mac = JavaMac.getInstance('HmacSHA256');
    mac.init(new JavaSecretKeySpec(key, 'HmacSHA256'));
    const result = mac.doFinal(data);
    expect(result.toString('hex')).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    );
  });

  // RFC 4231 Test Case 2
  it('should match RFC 4231 test vector 2 (HmacSHA256 with "Jefe" key)', () => {
    const key = Buffer.from('Jefe');
    const data = 'what do ya want for nothing?';
    const mac = JavaMac.getInstance('HmacSHA256');
    mac.init(new JavaSecretKeySpec(key, 'HmacSHA256'));
    const result = mac.doFinal(data);
    expect(result.toString('hex')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
    );
  });
});

// -------------------------------------------------------------------------
// SecureRandom
// -------------------------------------------------------------------------
describe('JavaSecureRandom', () => {
  it('should fill buffer with random bytes', () => {
    const buf = Buffer.alloc(32);
    const sr = new JavaSecureRandom();
    sr.nextBytes(buf);
    // Extremely unlikely to remain all zeros
    expect(buf.every(b => b === 0)).toBe(false);
  });

  it('should respect bound on nextInt()', () => {
    const sr = new JavaSecureRandom();
    for (let i = 0; i < 100; i++) {
      const val = sr.nextInt(10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(10);
    }
  });

  it('should return integer for nextInt() without bound', () => {
    const sr = new JavaSecureRandom();
    const val = sr.nextInt();
    expect(Number.isInteger(val)).toBe(true);
  });

  it('should be creatable via getInstance()', () => {
    const sr = JavaSecureRandom.getInstance('SHA1PRNG');
    expect(sr).toBeInstanceOf(JavaSecureRandom);
  });

  it('should produce different values on successive calls', () => {
    const sr = new JavaSecureRandom();
    const buf1 = Buffer.alloc(32);
    const buf2 = Buffer.alloc(32);
    sr.nextBytes(buf1);
    sr.nextBytes(buf2);
    // Extremely unlikely to be equal
    expect(buf1.equals(buf2)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// KeyGenerator
// -------------------------------------------------------------------------
describe('JavaKeyGenerator', () => {
  it('should generate key of default size', () => {
    const kg = JavaKeyGenerator.getInstance('AES');
    const key = kg.generateKey();
    expect(key.getEncoded().length).toBe(16); // 128 bits = 16 bytes
    expect(key.getAlgorithm()).toBe('AES');
  });

  it('should generate key of specified size (128)', () => {
    const kg = JavaKeyGenerator.getInstance('AES');
    kg.init(128);
    const key = kg.generateKey();
    expect(key.getEncoded().length).toBe(16);
  });

  it('should generate key of specified size (256)', () => {
    const kg = JavaKeyGenerator.getInstance('AES');
    kg.init(256);
    const key = kg.generateKey();
    expect(key.getEncoded().length).toBe(32); // 256 bits = 32 bytes
  });

  it('should generate unique keys each time', () => {
    const kg = JavaKeyGenerator.getInstance('AES');
    kg.init(128);
    const key1 = kg.generateKey();
    const key2 = kg.generateKey();
    expect(key1.getEncoded().equals(key2.getEncoded())).toBe(false);
  });

  it('should return JavaSecretKeySpec instances', () => {
    const kg = JavaKeyGenerator.getInstance('AES');
    kg.init(256);
    const key = kg.generateKey();
    expect(key).toBeInstanceOf(JavaSecretKeySpec);
  });
});

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------
describe('Cipher constants', () => {
  it('should export ENCRYPT_MODE = 1', () => {
    expect(ENCRYPT_MODE).toBe(1);
  });

  it('should export DECRYPT_MODE = 2', () => {
    expect(DECRYPT_MODE).toBe(2);
  });
});
