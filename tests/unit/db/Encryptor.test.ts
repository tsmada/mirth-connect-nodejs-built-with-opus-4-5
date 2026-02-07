import { describe, it, expect, afterEach } from '@jest/globals';
import {
  NoOpEncryptor,
  AesEncryptor,
  setEncryptor,
  getEncryptor,
  initEncryptorFromEnv,
} from '../../../src/db/Encryptor.js';

describe('NoOpEncryptor', () => {
  it('encrypt returns plaintext unchanged', () => {
    const enc = new NoOpEncryptor();
    expect(enc.encrypt('hello')).toBe('hello');
  });

  it('decrypt returns ciphertext unchanged', () => {
    const enc = new NoOpEncryptor();
    expect(enc.decrypt('hello')).toBe('hello');
  });
});

describe('AesEncryptor', () => {
  // Valid 256-bit key for testing
  const testKey = Buffer.alloc(32, 'test-key-padding!').toString('base64');

  it('round-trip: encrypt then decrypt returns original', () => {
    const enc = new AesEncryptor(testKey);
    const plaintext = 'MSH|^~\\&|SENDING|FACILITY|...';
    const encrypted = enc.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(enc.decrypt(encrypted)).toBe(plaintext);
  });

  it('rejects invalid key length', () => {
    expect(() => new AesEncryptor(Buffer.from('short').toString('base64'))).toThrow(
      'Invalid AES key length'
    );
  });

  it('decrypt fails on malformed ciphertext', () => {
    const enc = new AesEncryptor(testKey);
    expect(() => enc.decrypt('not-valid-format')).toThrow(
      'Invalid encrypted content format'
    );
  });

  it('handles empty string', () => {
    const enc = new AesEncryptor(testKey);
    const encrypted = enc.encrypt('');
    expect(enc.decrypt(encrypted)).toBe('');
  });

  it('handles unicode content', () => {
    const enc = new AesEncryptor(testKey);
    const plaintext = 'Ünïcödé ĉöntënt 日本語';
    expect(enc.decrypt(enc.encrypt(plaintext))).toBe(plaintext);
  });

  it('supports 128-bit key', () => {
    const key128 = Buffer.alloc(16, 'k').toString('base64');
    const enc = new AesEncryptor(key128);
    expect(enc.decrypt(enc.encrypt('test'))).toBe('test');
  });

  it('supports 192-bit key', () => {
    const key192 = Buffer.alloc(24, 'm').toString('base64');
    const enc = new AesEncryptor(key192);
    expect(enc.decrypt(enc.encrypt('test192'))).toBe('test192');
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const enc = new AesEncryptor(testKey);
    const plaintext = 'same input';
    const encrypted1 = enc.encrypt(plaintext);
    const encrypted2 = enc.encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
  });
});

describe('Module-level encryptor', () => {
  afterEach(() => {
    setEncryptor(new NoOpEncryptor()); // Reset
    delete process.env.MIRTH_ENCRYPTION_KEY;
  });

  it('defaults to NoOpEncryptor', () => {
    expect(getEncryptor()).toBeInstanceOf(NoOpEncryptor);
  });

  it('setEncryptor changes global encryptor', () => {
    const testKey = Buffer.alloc(32, 'x').toString('base64');
    setEncryptor(new AesEncryptor(testKey));
    expect(getEncryptor()).toBeInstanceOf(AesEncryptor);
  });

  it('initEncryptorFromEnv with key sets AesEncryptor', () => {
    process.env.MIRTH_ENCRYPTION_KEY = Buffer.alloc(32, 'y').toString('base64');
    initEncryptorFromEnv();
    expect(getEncryptor()).toBeInstanceOf(AesEncryptor);
  });

  it('initEncryptorFromEnv without key keeps NoOp', () => {
    delete process.env.MIRTH_ENCRYPTION_KEY;
    initEncryptorFromEnv();
    expect(getEncryptor()).toBeInstanceOf(NoOpEncryptor);
  });
});
