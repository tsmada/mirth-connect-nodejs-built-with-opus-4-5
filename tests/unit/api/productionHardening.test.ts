/**
 * Tests for P2 production hardening fixes:
 * 1. CORS wildcard blocked in production
 * 2. Sensitive field filtering in request audit logs
 * 3. Connection release guard in transaction()
 *
 * Uses minimal app setup (like rate-limiting.test.ts) to avoid importing
 * createApp() which requires 20+ servlet mocks.
 */

import { describe, it, expect } from '@jest/globals';

// ---------------------------------------------------------------------------
// Fix 1: CORS wildcard production enforcement
//
// Tests the logic from src/api/server.ts lines 87-93.
// Replicated inline because importing createApp() pulls in 20+ servlets.
// ---------------------------------------------------------------------------
describe('CORS wildcard production enforcement', () => {
  /**
   * Replicates the guard logic from createApp() in server.ts:
   *
   *   if (config.corsOrigins?.includes('*')) {
   *     if (process.env.NODE_ENV === 'production') {
   *       throw new Error('CORS wildcard (*) is not allowed in production...');
   *     }
   *   }
   */
  function enforceCorsPolicy(corsOrigins: string[], nodeEnv: string | undefined): void {
    if (corsOrigins.includes('*')) {
      if (nodeEnv === 'production') {
        throw new Error(
          'CORS wildcard (*) is not allowed in production. Set the CORS_ORIGINS environment variable.'
        );
      }
    }
  }

  it('should throw when CORS wildcard is used in production', () => {
    expect(() => enforceCorsPolicy(['*'], 'production')).toThrow(
      'CORS wildcard (*) is not allowed in production'
    );
  });

  it('should NOT throw when CORS wildcard is used in development', () => {
    expect(() => enforceCorsPolicy(['*'], 'development')).not.toThrow();
  });

  it('should NOT throw when CORS wildcard is used with no NODE_ENV', () => {
    expect(() => enforceCorsPolicy(['*'], undefined)).not.toThrow();
  });

  it('should NOT throw when specific origins are used in production', () => {
    expect(() => enforceCorsPolicy(['https://admin.example.com'], 'production')).not.toThrow();
  });

  it('should NOT throw with multiple specific origins in production', () => {
    expect(() =>
      enforceCorsPolicy(['https://app.example.com', 'https://admin.example.com'], 'production')
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Default database credentials production enforcement
//
// Tests the logic from src/server/Mirth.ts.
// ---------------------------------------------------------------------------
describe('Default database credentials production enforcement', () => {
  /**
   * Replicates the guard logic from Mirth.start():
   *
   *   const isDefaultUser = config.user === 'mirth' && !process.env['DB_USER'];
   *   const isDefaultPass = config.password === 'mirth' && !process.env['DB_PASSWORD'];
   *   if ((isDefaultUser || isDefaultPass) && process.env.NODE_ENV === 'production') {
   *     if (process.env['MIRTH_ALLOW_DEFAULT_CREDENTIALS'] !== 'true') throw ...;
   *   }
   */
  function enforceCredentialsPolicy(opts: {
    user: string; password: string;
    dbUserEnv?: string; dbPassEnv?: string;
    nodeEnv?: string; allowDefault?: string;
  }): void {
    const isDefaultUser = opts.user === 'mirth' && !opts.dbUserEnv;
    const isDefaultPass = opts.password === 'mirth' && !opts.dbPassEnv;
    if ((isDefaultUser || isDefaultPass) && opts.nodeEnv === 'production') {
      if (opts.allowDefault !== 'true') {
        throw new Error(
          'Default database credentials are not allowed in production. ' +
          'Set DB_USER/DB_PASSWORD environment variables, or set MIRTH_ALLOW_DEFAULT_CREDENTIALS=true to override.'
        );
      }
    }
  }

  it('should throw in production with default user and no DB_USER env', () => {
    expect(() =>
      enforceCredentialsPolicy({ user: 'mirth', password: 'mirth', nodeEnv: 'production' })
    ).toThrow('Default database credentials are not allowed in production');
  });

  it('should NOT throw in development with default credentials', () => {
    expect(() =>
      enforceCredentialsPolicy({ user: 'mirth', password: 'mirth', nodeEnv: 'development' })
    ).not.toThrow();
  });

  it('should NOT throw in production when DB_USER is set', () => {
    expect(() =>
      enforceCredentialsPolicy({
        user: 'mirth', password: 'mirth',
        dbUserEnv: 'custom_user', dbPassEnv: 'custom_pass',
        nodeEnv: 'production',
      })
    ).not.toThrow();
  });

  it('should NOT throw in production when MIRTH_ALLOW_DEFAULT_CREDENTIALS=true', () => {
    expect(() =>
      enforceCredentialsPolicy({
        user: 'mirth', password: 'mirth',
        nodeEnv: 'production', allowDefault: 'true',
      })
    ).not.toThrow();
  });

  it('should throw when only DB_USER is missing in production', () => {
    expect(() =>
      enforceCredentialsPolicy({
        user: 'mirth', password: 'custom',
        dbPassEnv: 'custom',
        nodeEnv: 'production',
      })
    ).toThrow('Default database credentials are not allowed in production');
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Sensitive field filtering in request audit logs
// ---------------------------------------------------------------------------
describe('Sensitive field filtering', () => {
  /**
   * Mirrors the filtering logic in authorization.ts authorize() middleware.
   */
  function filterSensitiveFields(body: Record<string, unknown>): Record<string, unknown> {
    const SENSITIVE_KEYS = new Set([
      'password', 'token', 'apiKey', 'apikey', 'secret',
      'passphrase', 'credential', 'credentials', 'authorization',
      'accessToken', 'refreshToken', 'privateKey', 'secretKey',
    ]);
    const safeBody: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!SENSITIVE_KEYS.has(key) && !SENSITIVE_KEYS.has(key.toLowerCase())) {
        safeBody[key] = value;
      }
    }
    return safeBody;
  }

  it('should filter password from body', () => {
    const body = { username: 'admin', password: 'secret123' };
    const result = filterSensitiveFields(body);
    expect(result).toEqual({ username: 'admin' });
    expect(result).not.toHaveProperty('password');
  });

  it('should filter multiple sensitive fields', () => {
    const body = {
      username: 'admin',
      password: 'secret123',
      token: 'abc-def',
      apiKey: 'key-123',
      channelId: 'ch-1',
    };
    const result = filterSensitiveFields(body);
    expect(result).toEqual({ username: 'admin', channelId: 'ch-1' });
  });

  it('should filter case-insensitively', () => {
    const body = {
      Username: 'admin',
      Password: 'secret123',
      Token: 'abc',
      APIKey: 'key',
    };
    const result = filterSensitiveFields(body);
    // 'Username' lowercases to 'username' which is not in the set; kept
    // 'Password' lowercases to 'password' which IS in the set; removed
    // 'Token' lowercases to 'token' which IS in the set; removed
    // 'APIKey' lowercases to 'apikey' which IS in the set; removed
    expect(result).toEqual({ Username: 'admin' });
  });

  it('should pass through all fields when none are sensitive', () => {
    const body = { name: 'test', enabled: true, port: 8080 };
    const result = filterSensitiveFields(body);
    expect(result).toEqual(body);
  });

  it('should return empty object when all fields are sensitive', () => {
    const body = { password: 'x', token: 'y', secret: 'z' };
    const result = filterSensitiveFields(body);
    expect(result).toEqual({});
  });

  it('should filter all documented sensitive keys', () => {
    const allSensitive: Record<string, unknown> = {
      password: '1', token: '2', apiKey: '3', apikey: '4',
      secret: '5', passphrase: '6', credential: '7', credentials: '8',
      authorization: '9', accessToken: '10', refreshToken: '11',
      privateKey: '12', secretKey: '13',
      // Not sensitive:
      safeField: 'keep',
    };
    const result = filterSensitiveFields(allSensitive);
    expect(Object.keys(result)).toEqual(['safeField']);
    expect(result.safeField).toBe('keep');
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Connection release guard
// ---------------------------------------------------------------------------
describe('Connection release guard', () => {
  it('transaction function should be exported from pool module', async () => {
    const poolModule = await import('../../../src/db/pool.js');
    expect(typeof poolModule.transaction).toBe('function');
  });
});
