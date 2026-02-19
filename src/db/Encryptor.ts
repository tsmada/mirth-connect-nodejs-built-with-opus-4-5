/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/Encryptor.java
 *
 * Interface for encrypting/decrypting message content in D_MC tables.
 * In takeover mode, Java Mirth may have stored content with IS_ENCRYPTED=1.
 */

import * as crypto from 'crypto';

export interface Encryptor {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/**
 * No-op encryptor — content stored/retrieved as plaintext.
 */
export class NoOpEncryptor implements Encryptor {
  encrypt(plaintext: string): string {
    return plaintext;
  }
  decrypt(ciphertext: string): string {
    return ciphertext;
  }
}

/**
 * AES encryptor compatible with Java Mirth's KeyEncryptor.
 * Uses AES-256-CBC with PKCS7 padding.
 * Key provided as base64-encoded string.
 */
export class AesEncryptor implements Encryptor {
  private key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 16 && this.key.length !== 24 && this.key.length !== 32) {
      throw new Error(`Invalid AES key length: ${this.key.length} bytes (expected 16, 24, or 32)`);
    }
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(`aes-${this.key.length * 8}-cbc`, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return iv.toString('base64') + ':' + encrypted.toString('base64');
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted content format (expected iv:ciphertext)');
    }
    const iv = Buffer.from(parts[0]!, 'base64');
    const encrypted = Buffer.from(parts[1]!, 'base64');
    const decipher = crypto.createDecipheriv(`aes-${this.key.length * 8}-cbc`, this.key, iv);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }
}

// Module-level singleton
let currentEncryptor: Encryptor = new NoOpEncryptor();

export function setEncryptor(encryptor: Encryptor): void {
  currentEncryptor = encryptor;
}

export function getEncryptor(): Encryptor {
  return currentEncryptor;
}

/**
 * Check whether real encryption is enabled (i.e. the encryptor is NOT a NoOp).
 */
export function isEncryptionEnabled(): boolean {
  return !(currentEncryptor instanceof NoOpEncryptor);
}

/**
 * Initialize encryptor from environment variables.
 */
export function initEncryptorFromEnv(): void {
  const key = process.env.MIRTH_ENCRYPTION_KEY;
  if (key) {
    setEncryptor(new AesEncryptor(key));
  }
}
