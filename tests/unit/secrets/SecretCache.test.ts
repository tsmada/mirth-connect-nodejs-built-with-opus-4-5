import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SecretCache } from '../../../src/secrets/SecretCache.js';
import type { SecretValue } from '../../../src/secrets/types.js';

function makeSecret(value: string, source = 'test'): SecretValue {
  return { value, source, fetchedAt: new Date() };
}

describe('SecretCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('basic get/set', () => {
    it('should return undefined for missing keys', () => {
      const cache = new SecretCache(300);

      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should store and retrieve a secret', () => {
      const cache = new SecretCache(300);
      const secret = makeSecret('my-password');

      cache.set('db.password', secret);
      const result = cache.get('db.password');

      expect(result).toBeDefined();
      expect(result!.value).toBe('my-password');
      expect(result!.source).toBe('test');
    });

    it('should overwrite existing entries', () => {
      const cache = new SecretCache(300);

      cache.set('key', makeSecret('old'));
      cache.set('key', makeSecret('new'));

      expect(cache.get('key')!.value).toBe('new');
    });
  });

  describe('TTL expiration', () => {
    it('should return entry before TTL expires', () => {
      const cache = new SecretCache(60); // 60 seconds
      cache.set('key', makeSecret('value'));

      // Advance 59 seconds
      jest.advanceTimersByTime(59_000);

      expect(cache.get('key')).toBeDefined();
    });

    it('should return undefined after TTL expires', () => {
      const cache = new SecretCache(60); // 60 seconds
      cache.set('key', makeSecret('value'));

      // Advance past TTL
      jest.advanceTimersByTime(61_000);

      expect(cache.get('key')).toBeUndefined();
    });

    it('should evict expired entries on access', () => {
      const cache = new SecretCache(60);
      cache.set('key', makeSecret('value'));

      jest.advanceTimersByTime(61_000);
      cache.get('key'); // triggers eviction

      // Entry should be removed from internal storage
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('has()', () => {
    it('should return true for existing non-expired keys', () => {
      const cache = new SecretCache(300);
      cache.set('key', makeSecret('value'));

      expect(cache.has('key')).toBe(true);
    });

    it('should return false for missing keys', () => {
      const cache = new SecretCache(300);

      expect(cache.has('missing')).toBe(false);
    });

    it('should return false for expired keys', () => {
      const cache = new SecretCache(10);
      cache.set('key', makeSecret('value'));

      jest.advanceTimersByTime(11_000);

      expect(cache.has('key')).toBe(false);
    });
  });

  describe('invalidate / invalidateAll', () => {
    it('should invalidate a single key', () => {
      const cache = new SecretCache(300);
      cache.set('a', makeSecret('1'));
      cache.set('b', makeSecret('2'));

      const deleted = cache.invalidate('a');

      expect(deleted).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeDefined();
    });

    it('should return false when invalidating non-existent key', () => {
      const cache = new SecretCache(300);

      expect(cache.invalidate('nope')).toBe(false);
    });

    it('should invalidate all entries', () => {
      const cache = new SecretCache(300);
      cache.set('a', makeSecret('1'));
      cache.set('b', makeSecret('2'));
      cache.set('c', makeSecret('3'));

      cache.invalidateAll();

      expect(cache.getStats().size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBeUndefined();
    });
  });

  describe('stats tracking', () => {
    it('should count cache misses', () => {
      const cache = new SecretCache(300);

      cache.get('missing1');
      cache.get('missing2');

      expect(cache.getStats().misses).toBe(2);
    });

    it('should count cache hits', () => {
      const cache = new SecretCache(300);
      cache.set('key', makeSecret('value'));

      cache.get('key');
      cache.get('key');
      cache.get('key');

      expect(cache.getStats().hits).toBe(3);
    });

    it('should count evictions on TTL expiry', () => {
      const cache = new SecretCache(10);
      cache.set('key', makeSecret('value'));

      jest.advanceTimersByTime(11_000);
      cache.get('key'); // triggers eviction

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
      expect(stats.misses).toBe(1); // expired read also counts as a miss
    });

    it('should report correct size', () => {
      const cache = new SecretCache(300);

      expect(cache.getStats().size).toBe(0);

      cache.set('a', makeSecret('1'));
      cache.set('b', makeSecret('2'));
      expect(cache.getStats().size).toBe(2);

      cache.invalidate('a');
      expect(cache.getStats().size).toBe(1);
    });
  });

  describe('keys()', () => {
    it('should return all non-expired keys', () => {
      const cache = new SecretCache(300);
      cache.set('a', makeSecret('1'));
      cache.set('b', makeSecret('2'));
      cache.set('c', makeSecret('3'));

      expect(cache.keys().sort()).toEqual(['a', 'b', 'c']);
    });

    it('should exclude expired keys', () => {
      const cache = new SecretCache(10);
      cache.set('expires-soon', makeSecret('1'));

      jest.advanceTimersByTime(5_000);
      // Add a second key with fresh TTL
      cache.set('still-valid', makeSecret('2'));

      jest.advanceTimersByTime(6_000); // first key expired, second still valid

      expect(cache.keys()).toEqual(['still-valid']);
    });

    it('should return empty array when cache is empty', () => {
      const cache = new SecretCache(300);

      expect(cache.keys()).toEqual([]);
    });
  });

  describe('encryption at rest', () => {
    // A valid AES-256 key (32 bytes, base64-encoded)
    const encryptionKey = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

    it('should store encrypted value when encryption key is provided', () => {
      const cache = new SecretCache(300, encryptionKey);
      const secret = makeSecret('super-secret-password');

      cache.set('db.password', secret);

      // Access the internal entry via get() -- value should be decrypted on read
      const result = cache.get('db.password');
      expect(result).toBeDefined();
      expect(result!.value).toBe('super-secret-password');
    });

    it('should decrypt on read and return correct value', () => {
      const cache = new SecretCache(300, encryptionKey);

      cache.set('key1', makeSecret('value-one'));
      cache.set('key2', makeSecret('value-two'));

      expect(cache.get('key1')!.value).toBe('value-one');
      expect(cache.get('key2')!.value).toBe('value-two');
    });

    it('should preserve source metadata with encryption', () => {
      const cache = new SecretCache(300, encryptionKey);
      const secret: SecretValue = {
        value: 'secret',
        source: 'vault',
        fetchedAt: new Date('2026-01-01'),
        version: 'v3',
      };

      cache.set('key', secret);
      const result = cache.get('key')!;

      expect(result.source).toBe('vault');
      expect(result.version).toBe('v3');
      expect(result.value).toBe('secret');
    });

    it('should work without encryption key (plaintext)', () => {
      const cache = new SecretCache(300); // no key
      cache.set('key', makeSecret('plaintext-value'));

      expect(cache.get('key')!.value).toBe('plaintext-value');
    });
  });
});
