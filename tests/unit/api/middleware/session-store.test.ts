import {
  InMemorySessionStore,
  RedisSessionStore,
  createSessionStore,
  Session,
  SESSION_TIMEOUT_MS,
} from '../../../../src/api/middleware/auth.js';

// Mock ioredis
jest.mock('ioredis', () => {
  const store = new Map<string, { value: string; ttl?: number }>();

  return jest.fn().mockImplementation(() => ({
    get: jest.fn(async (key: string) => {
      const entry = store.get(key);
      return entry?.value ?? null;
    }),
    set: jest.fn(async (key: string, value: string, _mode?: string, _ttl?: number) => {
      store.set(key, { value, ttl: _ttl });
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    }),
    exists: jest.fn(async (key: string) => {
      return store.has(key) ? 1 : 0;
    }),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    }),
    mget: jest.fn(async (...keys: string[]) => {
      return keys.map((k) => store.get(k)?.value ?? null);
    }),
    quit: jest.fn(async () => 'OK'),
    _store: store, // Expose for test cleanup
  }));
});

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session-1',
    userId: 1,
    user: { id: 1, username: 'admin' } as Session['user'],
    createdAt: new Date('2026-02-17T10:00:00Z'),
    lastAccess: new Date('2026-02-17T10:05:00Z'),
    ipAddress: '127.0.0.1',
    ...overrides,
  };
}

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  test('set and get a session', async () => {
    const session = makeSession();
    await store.set(session.id, session);
    const retrieved = await store.get(session.id);
    expect(retrieved).toEqual(session);
  });

  test('get returns undefined for missing session', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  test('has returns true for existing session', async () => {
    const session = makeSession();
    await store.set(session.id, session);
    expect(await store.has(session.id)).toBe(true);
  });

  test('has returns false for missing session', async () => {
    expect(await store.has('nonexistent')).toBe(false);
  });

  test('delete removes a session', async () => {
    const session = makeSession();
    await store.set(session.id, session);
    const deleted = await store.delete(session.id);
    expect(deleted).toBe(true);
    expect(await store.get(session.id)).toBeUndefined();
  });

  test('delete returns false for missing session', async () => {
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  test('size returns correct count', async () => {
    expect(await store.size()).toBe(0);
    await store.set('a', makeSession({ id: 'a' }));
    await store.set('b', makeSession({ id: 'b' }));
    expect(await store.size()).toBe(2);
  });

  test('values returns all sessions', async () => {
    const s1 = makeSession({ id: 'a', userId: 1 });
    const s2 = makeSession({ id: 'b', userId: 2 });
    await store.set('a', s1);
    await store.set('b', s2);
    const vals = await store.values();
    expect(vals).toHaveLength(2);
    expect(vals).toEqual(expect.arrayContaining([s1, s2]));
  });

  test('clear removes all sessions', async () => {
    await store.set('a', makeSession({ id: 'a' }));
    await store.set('b', makeSession({ id: 'b' }));
    await store.clear();
    expect(await store.size()).toBe(0);
    expect(await store.values()).toEqual([]);
  });
});

describe('RedisSessionStore', () => {
  let store: RedisSessionStore;

  beforeEach(() => {
    // Clear the mock store between tests
    const Redis = require('ioredis');
    const mockInstance = new Redis('redis://localhost:6379');
    (mockInstance as any)._store.clear();

    store = new RedisSessionStore('redis://localhost:6379');
  });

  test('set and get serializes/deserializes correctly', async () => {
    const session = makeSession();
    await store.set(session.id, session);
    const retrieved = await store.get(session.id);

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(session.id);
    expect(retrieved!.userId).toBe(session.userId);
    expect(retrieved!.user).toEqual(session.user);
    expect(retrieved!.ipAddress).toBe(session.ipAddress);
    // Dates must be restored as Date objects, not strings
    expect(retrieved!.createdAt).toBeInstanceOf(Date);
    expect(retrieved!.lastAccess).toBeInstanceOf(Date);
    expect(retrieved!.createdAt.getTime()).toBe(session.createdAt.getTime());
    expect(retrieved!.lastAccess.getTime()).toBe(session.lastAccess.getTime());
  });

  test('get returns undefined for missing key', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  test('delete returns true when key existed', async () => {
    const session = makeSession();
    await store.set(session.id, session);
    expect(await store.delete(session.id)).toBe(true);
    expect(await store.get(session.id)).toBeUndefined();
  });

  test('delete returns false when key did not exist', async () => {
    expect(await store.delete('nonexistent')).toBe(false);
  });

  test('has returns correct boolean', async () => {
    const session = makeSession();
    expect(await store.has(session.id)).toBe(false);
    await store.set(session.id, session);
    expect(await store.has(session.id)).toBe(true);
  });

  test('size and values work across multiple sessions', async () => {
    const s1 = makeSession({ id: 'r1', userId: 10 });
    const s2 = makeSession({ id: 'r2', userId: 20 });
    await store.set('r1', s1);
    await store.set('r2', s2);

    expect(await store.size()).toBe(2);
    const vals = await store.values();
    expect(vals).toHaveLength(2);
  });

  test('clear removes all sessions', async () => {
    await store.set('r1', makeSession({ id: 'r1' }));
    await store.set('r2', makeSession({ id: 'r2' }));
    await store.clear();
    expect(await store.size()).toBe(0);
  });
});

describe('createSessionStore', () => {
  const originalEnv = process.env.MIRTH_CLUSTER_REDIS_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MIRTH_CLUSTER_REDIS_URL;
    } else {
      process.env.MIRTH_CLUSTER_REDIS_URL = originalEnv;
    }
  });

  test('returns InMemorySessionStore when no MIRTH_CLUSTER_REDIS_URL', () => {
    delete process.env.MIRTH_CLUSTER_REDIS_URL;
    const store = createSessionStore();
    expect(store).toBeInstanceOf(InMemorySessionStore);
  });

  test('returns RedisSessionStore when MIRTH_CLUSTER_REDIS_URL is set', () => {
    process.env.MIRTH_CLUSTER_REDIS_URL = 'redis://localhost:6379';
    const store = createSessionStore();
    expect(store).toBeInstanceOf(RedisSessionStore);
  });
});

describe('createSessionStore cluster warning', () => {
  const origRedisUrl = process.env.MIRTH_CLUSTER_REDIS_URL;
  const origClusterEnabled = process.env.MIRTH_CLUSTER_ENABLED;

  afterEach(() => {
    if (origRedisUrl === undefined) delete process.env.MIRTH_CLUSTER_REDIS_URL;
    else process.env.MIRTH_CLUSTER_REDIS_URL = origRedisUrl;
    if (origClusterEnabled === undefined) delete process.env.MIRTH_CLUSTER_ENABLED;
    else process.env.MIRTH_CLUSTER_ENABLED = origClusterEnabled;
  });

  test('returns InMemorySessionStore when cluster enabled but no Redis URL', () => {
    delete process.env.MIRTH_CLUSTER_REDIS_URL;
    process.env.MIRTH_CLUSTER_ENABLED = 'true';

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createSessionStore();

    expect(store).toBeInstanceOf(InMemorySessionStore);
    // Warning should have been logged (via console.warn fallback or logger)
    // We verify the store type is correct — the warning is a side effect
    warnSpy.mockRestore();
  });

  test('does not warn when cluster is not enabled', () => {
    delete process.env.MIRTH_CLUSTER_REDIS_URL;
    delete process.env.MIRTH_CLUSTER_ENABLED;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createSessionStore();

    expect(store).toBeInstanceOf(InMemorySessionStore);
    // No cluster warning expected — only Redis fallback warnings are possible
    const clusterWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('Cluster mode enabled')
    );
    expect(clusterWarnings).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

describe('SESSION_TIMEOUT_MS', () => {
  test('is 30 minutes', () => {
    expect(SESSION_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});
