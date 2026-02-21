/**
 * Java Crypto Shims — Node.js implementations of javax.crypto.* and
 * java.security.* classes used by real-world Mirth Connect channels.
 *
 * In Java Mirth, channels frequently use:
 *   - java.security.MessageDigest for hashing (SHA-256, MD5)
 *   - java.util.Base64 for encoding/decoding
 *   - javax.crypto.Cipher for AES encryption/decryption
 *   - javax.crypto.Mac for HMAC signatures
 *   - javax.crypto.spec.SecretKeySpec / IvParameterSpec for key/IV construction
 *   - java.security.SecureRandom for cryptographic RNG
 *   - javax.crypto.KeyGenerator for symmetric key generation
 *
 * All APIs are synchronous, matching Java's blocking behavior and the
 * requirement of the V8 VM sandbox (no async/await available in user scripts).
 *
 * Backed by Node.js built-in `crypto` module — no external dependencies.
 */

import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function normalizeAlgorithm(javaName: string): string {
  const map: Record<string, string> = {
    'SHA-256': 'sha256',
    'SHA-1': 'sha1',
    'MD5': 'md5',
    'SHA-512': 'sha512',
    'SHA-384': 'sha384',
    'SHA-224': 'sha224',
    'HmacSHA256': 'sha256',
    'HmacSHA1': 'sha1',
    'HmacSHA384': 'sha384',
    'HmacSHA512': 'sha512',
    'HmacMD5': 'md5',
  };
  return map[javaName] ?? javaName.toLowerCase().replace(/-/g, '');
}

function toBuffer(data: string | Buffer): Buffer {
  return typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
}

// ---------------------------------------------------------------------------
// Cipher constants
// ---------------------------------------------------------------------------

export const ENCRYPT_MODE = 1;
export const DECRYPT_MODE = 2;

// ---------------------------------------------------------------------------
// java.security.MessageDigest
// ---------------------------------------------------------------------------

export class JavaMessageDigest {
  private algorithm: string;
  private hash: crypto.Hash;

  private constructor(algorithm: string) {
    const normalized = normalizeAlgorithm(algorithm);
    // Validate that the algorithm is available
    if (!crypto.getHashes().includes(normalized)) {
      throw new Error(`NoSuchAlgorithmException: ${algorithm}`);
    }
    this.algorithm = normalized;
    this.hash = crypto.createHash(this.algorithm);
  }

  static getInstance(algorithm: string): JavaMessageDigest {
    return new JavaMessageDigest(algorithm);
  }

  update(data: string | Buffer): void {
    this.hash.update(toBuffer(data));
  }

  digest(data?: string | Buffer): Buffer {
    if (data !== undefined) {
      this.hash.update(toBuffer(data));
    }
    const result = this.hash.digest();
    // Reset after digest (matches Java behavior)
    this.hash = crypto.createHash(this.algorithm);
    return result;
  }

  reset(): void {
    this.hash = crypto.createHash(this.algorithm);
  }
}

// ---------------------------------------------------------------------------
// java.util.Base64
// ---------------------------------------------------------------------------

class Base64Encoder {
  private urlSafe: boolean;
  private mime: boolean;

  constructor(urlSafe = false, mime = false) {
    this.urlSafe = urlSafe;
    this.mime = mime;
  }

  encode(buf: Buffer): Buffer {
    return Buffer.from(this.encodeToString(buf), 'ascii');
  }

  encodeToString(buf: Buffer): string {
    let encoded = buf.toString('base64');
    if (this.urlSafe) {
      encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    if (this.mime) {
      // MIME: line breaks at 76 chars with \r\n
      encoded = encoded.replace(/(.{76})/g, '$1\r\n');
      // Remove trailing \r\n if it was added
      if (encoded.endsWith('\r\n')) {
        encoded = encoded.slice(0, -2);
      }
    }
    return encoded;
  }
}

class Base64Decoder {
  private urlSafe: boolean;

  constructor(urlSafe = false) {
    this.urlSafe = urlSafe;
  }

  decode(input: string | Buffer): Buffer {
    let str = typeof input === 'string' ? input : input.toString('ascii');
    if (this.urlSafe) {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      // Re-add padding
      while (str.length % 4 !== 0) str += '=';
    }
    // Strip MIME line breaks
    str = str.replace(/[\r\n]/g, '');
    return Buffer.from(str, 'base64');
  }
}

export class JavaBase64 {
  static getEncoder(): Base64Encoder {
    return new Base64Encoder();
  }

  static getDecoder(): Base64Decoder {
    return new Base64Decoder();
  }

  static getMimeEncoder(): Base64Encoder {
    return new Base64Encoder(false, true);
  }

  static getMimeDecoder(): Base64Decoder {
    return new Base64Decoder(); // MIME decoder strips line breaks in decode()
  }

  static getUrlEncoder(): Base64Encoder {
    return new Base64Encoder(true);
  }

  static getUrlDecoder(): Base64Decoder {
    return new Base64Decoder(true);
  }
}

// ---------------------------------------------------------------------------
// javax.crypto.spec.SecretKeySpec
// ---------------------------------------------------------------------------

export class JavaSecretKeySpec {
  private keyBytes: Buffer;
  private algorithm: string;

  constructor(keyBytes: Buffer, algorithm: string) {
    this.keyBytes = Buffer.from(keyBytes);
    this.algorithm = algorithm;
  }

  getEncoded(): Buffer {
    return Buffer.from(this.keyBytes);
  }

  getAlgorithm(): string {
    return this.algorithm;
  }
}

// ---------------------------------------------------------------------------
// javax.crypto.spec.IvParameterSpec
// ---------------------------------------------------------------------------

export class JavaIvParameterSpec {
  private ivBytes: Buffer;

  constructor(ivBytes: Buffer) {
    this.ivBytes = Buffer.from(ivBytes);
  }

  getIV(): Buffer {
    return Buffer.from(this.ivBytes);
  }
}

// ---------------------------------------------------------------------------
// javax.crypto.Cipher
// ---------------------------------------------------------------------------

export class JavaCipher {
  private algorithm: string;
  private mode: string;
  private padding: string;
  private opMode: number = 0;
  private key: Buffer = Buffer.alloc(0);
  private iv: Buffer | null = null;
  private accumulated: Buffer[] = [];

  private constructor(transformation: string) {
    const parts = transformation.split('/');
    this.algorithm = parts[0]!;
    this.mode = parts.length > 1 ? parts[1]! : 'ECB';
    this.padding = parts.length > 2 ? parts[2]! : 'PKCS5Padding';
  }

  static getInstance(transformation: string): JavaCipher {
    return new JavaCipher(transformation);
  }

  init(opMode: number, key: JavaSecretKeySpec | Buffer, iv?: JavaIvParameterSpec | Buffer): void {
    this.opMode = opMode;
    this.key = key instanceof JavaSecretKeySpec ? key.getEncoded() : Buffer.from(key);
    if (iv) {
      this.iv = iv instanceof JavaIvParameterSpec ? iv.getIV() : Buffer.from(iv);
    } else {
      this.iv = null;
    }
    this.accumulated = [];
  }

  update(data: string | Buffer): Buffer {
    this.accumulated.push(toBuffer(data));
    // For incremental update, return empty buffer (data buffered for doFinal)
    return Buffer.alloc(0);
  }

  doFinal(data?: string | Buffer): Buffer {
    if (data !== undefined) {
      this.accumulated.push(toBuffer(data));
    }

    const input = Buffer.concat(this.accumulated);
    this.accumulated = [];

    const nodeAlgo = this.getNodeCipherName();
    const noPadding = this.padding === 'NoPadding';

    if (this.opMode === ENCRYPT_MODE) {
      return this.encrypt(nodeAlgo, input, noPadding);
    } else {
      return this.decrypt(nodeAlgo, input, noPadding);
    }
  }

  private encrypt(nodeAlgo: string, input: Buffer, noPadding: boolean): Buffer {
    const iv = this.mode === 'ECB' ? Buffer.alloc(0) : this.iv!;
    const cipher = crypto.createCipheriv(nodeAlgo, this.key, iv);
    if (noPadding) {
      cipher.setAutoPadding(false);
    }
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);

    if (this.mode === 'GCM') {
      // Append auth tag for GCM
      const authTag = (cipher as crypto.CipherGCM).getAuthTag();
      return Buffer.concat([encrypted, authTag]);
    }

    return encrypted;
  }

  private decrypt(nodeAlgo: string, input: Buffer, noPadding: boolean): Buffer {
    let ciphertext = input;
    let authTag: Buffer | undefined;

    if (this.mode === 'GCM') {
      // Last 16 bytes are the auth tag
      authTag = input.subarray(input.length - 16);
      ciphertext = input.subarray(0, input.length - 16);
    }

    const iv = this.mode === 'ECB' ? Buffer.alloc(0) : this.iv!;
    const decipher = crypto.createDecipheriv(nodeAlgo, this.key, iv);
    if (noPadding) {
      decipher.setAutoPadding(false);
    }
    if (authTag) {
      (decipher as crypto.DecipherGCM).setAuthTag(authTag);
    }

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private getNodeCipherName(): string {
    const algo = this.algorithm.toUpperCase();
    if (algo === 'AES') {
      const keyBits = this.key.length * 8;
      const mode = this.mode.toLowerCase();
      return `aes-${keyBits}-${mode}`;
    }
    // DES, DESede, etc. — pass through
    return `${algo.toLowerCase()}-${this.mode.toLowerCase()}`;
  }
}

// ---------------------------------------------------------------------------
// javax.crypto.Mac
// ---------------------------------------------------------------------------

export class JavaMac {
  private algorithm: string;
  private hmac: crypto.Hmac | null = null;
  private keySpec: JavaSecretKeySpec | null = null;

  private constructor(algorithm: string) {
    const normalized = normalizeAlgorithm(algorithm);
    // Validate
    if (!crypto.getHashes().includes(normalized)) {
      throw new Error(`NoSuchAlgorithmException: ${algorithm}`);
    }
    this.algorithm = normalized;
  }

  static getInstance(algorithm: string): JavaMac {
    return new JavaMac(algorithm);
  }

  init(keySpec: JavaSecretKeySpec): void {
    this.keySpec = keySpec;
    this.hmac = crypto.createHmac(this.algorithm, keySpec.getEncoded());
  }

  update(data: string | Buffer): void {
    if (!this.hmac) throw new Error('Mac not initialized');
    this.hmac.update(toBuffer(data));
  }

  doFinal(data?: string | Buffer): Buffer {
    if (!this.hmac) throw new Error('Mac not initialized');
    if (data !== undefined) {
      this.hmac.update(toBuffer(data));
    }
    const result = this.hmac.digest();
    // Reset HMAC for reuse (matches Java behavior after doFinal)
    this.hmac = crypto.createHmac(this.algorithm, this.keySpec!.getEncoded());
    return result;
  }
}

// ---------------------------------------------------------------------------
// java.security.SecureRandom
// ---------------------------------------------------------------------------

export class JavaSecureRandom {
  static getInstance(_algorithm?: string): JavaSecureRandom {
    return new JavaSecureRandom();
  }

  nextBytes(buffer: Buffer): void {
    crypto.randomFillSync(buffer);
  }

  nextInt(bound?: number): number {
    if (bound !== undefined) {
      return crypto.randomInt(bound);
    }
    // Random 32-bit signed integer
    return crypto.randomInt(-2147483648, 2147483647);
  }
}

// ---------------------------------------------------------------------------
// javax.crypto.KeyGenerator
// ---------------------------------------------------------------------------

export class JavaKeyGenerator {
  private algorithm: string;
  private keySize: number;

  private constructor(algorithm: string) {
    this.algorithm = algorithm;
    // Default key size based on algorithm
    this.keySize = algorithm.toUpperCase() === 'AES' ? 128 : 128;
  }

  static getInstance(algorithm: string): JavaKeyGenerator {
    return new JavaKeyGenerator(algorithm);
  }

  init(keySize: number): void {
    this.keySize = keySize;
  }

  generateKey(): JavaSecretKeySpec {
    const keyBytes = crypto.randomBytes(this.keySize / 8);
    return new JavaSecretKeySpec(keyBytes, this.algorithm);
  }
}
