/**
 * TTL cache for resolved secrets.
 * Optional AES encryption at rest using the existing Encryptor module.
 */
import { AesEncryptor, type Encryptor } from '../db/Encryptor.js';
import type { SecretValue } from './types.js';

interface CacheEntry {
  secret: SecretValue;
  encryptedValue?: string;   // if encryption enabled, value stored encrypted
  expiresAt: number;         // Date.now() + ttl
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

export class SecretCache {
  private entries = new Map<string, CacheEntry>();
  private ttlMs: number;
  private encryptor: Encryptor | null = null;
  private stats = { hits: 0, misses: 0, evictions: 0 };

  constructor(ttlSeconds: number, encryptionKey?: string) {
    this.ttlMs = ttlSeconds * 1000;
    if (encryptionKey) {
      this.encryptor = new AesEncryptor(encryptionKey);
    }
  }

  get(key: string): SecretValue | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    // Decrypt value if encryption is enabled
    if (this.encryptor && entry.encryptedValue) {
      return { ...entry.secret, value: this.encryptor.decrypt(entry.encryptedValue) };
    }
    return entry.secret;
  }

  set(key: string, secret: SecretValue): void {
    const entry: CacheEntry = {
      secret,
      expiresAt: Date.now() + this.ttlMs,
    };
    if (this.encryptor) {
      entry.encryptedValue = this.encryptor.encrypt(secret.value);
      // Store a redacted copy in the secret field when encrypting
      entry.secret = { ...secret, value: '[encrypted]' };
    }
    this.entries.set(key, entry);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  invalidate(key: string): boolean {
    return this.entries.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
  }

  getStats(): CacheStats {
    return {
      size: this.entries.size,
      ...this.stats,
    };
  }

  /**
   * Get all non-expired keys.
   */
  keys(): string[] {
    const now = Date.now();
    const result: string[] = [];
    for (const [key, entry] of this.entries) {
      if (now <= entry.expiresAt) {
        result.push(key);
      }
    }
    return result;
  }
}
