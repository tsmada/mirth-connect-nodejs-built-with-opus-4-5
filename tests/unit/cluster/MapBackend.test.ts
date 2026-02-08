import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock the database pool before importing DatabaseMapBackend
// ---------------------------------------------------------------------------

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockExecute = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.mock('../../../src/db/pool.js', () => ({
  getPool: () => ({
    query: mockQuery,
    execute: mockExecute,
  }),
}));

import {
  InMemoryMapBackend,
  DatabaseMapBackend,
  RedisMapBackend,
} from '../../../src/cluster/MapBackend.js';
import {
  GlobalMap,
  GlobalChannelMapStore,
} from '../../../src/javascript/userutil/MirthMap.js';

// ---------------------------------------------------------------------------
// InMemoryMapBackend
// ---------------------------------------------------------------------------

describe('InMemoryMapBackend', () => {
  let backend: InMemoryMapBackend;

  beforeEach(() => {
    backend = new InMemoryMapBackend();
  });

  it('should return undefined for missing key', async () => {
    expect(await backend.get('missing')).toBeUndefined();
  });

  it('should set and get a value', async () => {
    await backend.set('key1', 'value1');
    expect(await backend.get('key1')).toBe('value1');
  });

  it('should overwrite existing value', async () => {
    await backend.set('key1', 'first');
    await backend.set('key1', 'second');
    expect(await backend.get('key1')).toBe('second');
  });

  it('should store complex objects', async () => {
    const obj = { nested: { count: 42 }, arr: [1, 2, 3] };
    await backend.set('complex', obj);
    expect(await backend.get('complex')).toEqual(obj);
  });

  it('should delete existing key and return true', async () => {
    await backend.set('key1', 'value1');
    expect(await backend.delete('key1')).toBe(true);
    expect(await backend.get('key1')).toBeUndefined();
  });

  it('should return false when deleting missing key', async () => {
    expect(await backend.delete('missing')).toBe(false);
  });

  it('should report has correctly', async () => {
    expect(await backend.has('key1')).toBe(false);
    await backend.set('key1', 'value1');
    expect(await backend.has('key1')).toBe(true);
  });

  it('should return all entries via getAll', async () => {
    await backend.set('a', 1);
    await backend.set('b', 2);
    const all = await backend.getAll();
    expect(all.size).toBe(2);
    expect(all.get('a')).toBe(1);
    expect(all.get('b')).toBe(2);
  });

  it('should return a copy from getAll, not the internal map', async () => {
    await backend.set('a', 1);
    const all = await backend.getAll();
    all.set('injected', 'bad');
    expect(await backend.has('injected')).toBe(false);
  });

  it('should clear all entries', async () => {
    await backend.set('a', 1);
    await backend.set('b', 2);
    await backend.clear();
    expect(await backend.has('a')).toBe(false);
    expect(await backend.has('b')).toBe(false);
    expect((await backend.getAll()).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DatabaseMapBackend
// ---------------------------------------------------------------------------

describe('DatabaseMapBackend', () => {
  let backend: DatabaseMapBackend;
  const SCOPE = 'global';

  beforeEach(() => {
    backend = new DatabaseMapBackend(SCOPE);
    mockQuery.mockReset();
    mockExecute.mockReset();
  });

  afterEach(() => {
    mockQuery.mockReset();
    mockExecute.mockReset();
  });

  describe('get', () => {
    it('should return undefined when key not found', async () => {
      mockQuery.mockResolvedValue([[]]);
      expect(await backend.get('missing')).toBeUndefined();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT MAP_VALUE FROM D_GLOBAL_MAP'),
        [SCOPE, 'missing']
      );
    });

    it('should return parsed JSON value', async () => {
      mockQuery.mockResolvedValue([[{ MAP_VALUE: '"hello"' }]]);
      expect(await backend.get('key1')).toBe('hello');
    });

    it('should return parsed object value', async () => {
      const obj = { count: 42 };
      mockQuery.mockResolvedValue([[{ MAP_VALUE: JSON.stringify(obj) }]]);
      expect(await backend.get('key1')).toEqual(obj);
    });

    it('should return raw string when JSON parse fails', async () => {
      mockQuery.mockResolvedValue([[{ MAP_VALUE: 'not-json{' }]]);
      expect(await backend.get('key1')).toBe('not-json{');
    });

    it('should return undefined when MAP_VALUE is null', async () => {
      mockQuery.mockResolvedValue([[{ MAP_VALUE: null }]]);
      expect(await backend.get('key1')).toBeUndefined();
    });
  });

  describe('set', () => {
    it('should execute upsert with JSON-serialized value', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
      await backend.set('key1', { data: 'test' });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO D_GLOBAL_MAP'),
        [SCOPE, 'key1', JSON.stringify({ data: 'test' })]
      );
    });

    it('should serialize string values as JSON', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
      await backend.set('key1', 'plain string');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.anything(),
        [SCOPE, 'key1', '"plain string"']
      );
    });

    it('should serialize null values', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
      await backend.set('key1', null);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.anything(),
        [SCOPE, 'key1', 'null']
      );
    });
  });

  describe('delete', () => {
    it('should return true when row deleted', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
      expect(await backend.delete('key1')).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM D_GLOBAL_MAP'),
        [SCOPE, 'key1']
      );
    });

    it('should return false when no row found', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 0 }]);
      expect(await backend.delete('missing')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return empty map when no rows', async () => {
      mockQuery.mockResolvedValue([[]]);
      const all = await backend.getAll();
      expect(all.size).toBe(0);
    });

    it('should parse all values from rows', async () => {
      mockQuery.mockResolvedValue([[
        { MAP_KEY: 'a', MAP_VALUE: '"hello"' },
        { MAP_KEY: 'b', MAP_VALUE: '42' },
        { MAP_KEY: 'c', MAP_VALUE: null },
      ]]);
      const all = await backend.getAll();
      expect(all.size).toBe(3);
      expect(all.get('a')).toBe('hello');
      expect(all.get('b')).toBe(42);
      expect(all.get('c')).toBeUndefined();
    });

    it('should pass scope to query', async () => {
      mockQuery.mockResolvedValue([[]]);
      await backend.getAll();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE SCOPE = ?'),
        [SCOPE]
      );
    });
  });

  describe('clear', () => {
    it('should delete all rows for scope', async () => {
      mockExecute.mockResolvedValue([{ affectedRows: 5 }]);
      await backend.clear();
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM D_GLOBAL_MAP WHERE SCOPE = ?'),
        [SCOPE]
      );
    });
  });

  describe('has', () => {
    it('should return true when row exists', async () => {
      mockQuery.mockResolvedValue([[{ MAP_KEY: '1', MAP_VALUE: null }]]);
      expect(await backend.has('key1')).toBe(true);
    });

    it('should return false when no row', async () => {
      mockQuery.mockResolvedValue([[]]);
      expect(await backend.has('missing')).toBe(false);
    });
  });

  describe('scope isolation', () => {
    it('should use different scopes for different backends', async () => {
      const globalBackend = new DatabaseMapBackend('global');
      const channelBackend = new DatabaseMapBackend('gcm:channel-123');

      mockQuery.mockResolvedValue([[]]);

      await globalBackend.get('key1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.anything(),
        ['global', 'key1']
      );

      await channelBackend.get('key1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.anything(),
        ['gcm:channel-123', 'key1']
      );
    });
  });
});

// ---------------------------------------------------------------------------
// RedisMapBackend (stub - should throw)
// ---------------------------------------------------------------------------

describe('RedisMapBackend', () => {
  it('should throw for all operations', async () => {
    const backend = new RedisMapBackend('gm');

    await expect(backend.get('key')).rejects.toThrow('Redis backend requires ioredis dependency');
    await expect(backend.set('key', 'val')).rejects.toThrow('Redis backend requires ioredis dependency');
    await expect(backend.delete('key')).rejects.toThrow('Redis backend requires ioredis dependency');
    await expect(backend.getAll()).rejects.toThrow('Redis backend requires ioredis dependency');
    await expect(backend.clear()).rejects.toThrow('Redis backend requires ioredis dependency');
    await expect(backend.has('key')).rejects.toThrow('Redis backend requires ioredis dependency');
  });
});

// ---------------------------------------------------------------------------
// GlobalMap write-through behavior
// ---------------------------------------------------------------------------

describe('GlobalMap with MapBackend', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
  });

  afterEach(() => {
    GlobalMap.resetInstance();
  });

  it('should work without a backend (default behavior)', () => {
    const gm = GlobalMap.getInstance();
    gm.put('key1', 'value1');
    expect(gm.get('key1')).toBe('value1');
    expect(GlobalMap.getBackend()).toBeNull();
  });

  it('should write through to backend on put', async () => {
    const backend = new InMemoryMapBackend();
    GlobalMap.setBackend(backend);

    const gm = GlobalMap.getInstance();
    gm.put('key1', 'hello');

    // In-memory read is synchronous
    expect(gm.get('key1')).toBe('hello');

    // Backend write is async fire-and-forget, wait for microtask
    await new Promise((r) => setTimeout(r, 10));
    expect(await backend.get('key1')).toBe('hello');
  });

  it('should write through to backend on remove', async () => {
    const backend = new InMemoryMapBackend();
    await backend.set('key1', 'hello');
    GlobalMap.setBackend(backend);

    const gm = GlobalMap.getInstance();
    gm.put('key1', 'hello');
    gm.remove('key1');

    expect(gm.get('key1')).toBeUndefined();

    await new Promise((r) => setTimeout(r, 10));
    expect(await backend.has('key1')).toBe(false);
  });

  it('should write through to backend on clear', async () => {
    const backend = new InMemoryMapBackend();
    GlobalMap.setBackend(backend);

    const gm = GlobalMap.getInstance();
    gm.put('a', 1);
    gm.put('b', 2);

    await new Promise((r) => setTimeout(r, 10));
    expect((await backend.getAll()).size).toBe(2);

    gm.clear();

    await new Promise((r) => setTimeout(r, 10));
    expect((await backend.getAll()).size).toBe(0);
  });

  it('should load from backend', async () => {
    const backend = new InMemoryMapBackend();
    await backend.set('preloaded', 'data');
    GlobalMap.setBackend(backend);

    const gm = GlobalMap.getInstance();
    await gm.loadFromBackend();

    expect(gm.get('preloaded')).toBe('data');
  });
});

// ---------------------------------------------------------------------------
// GlobalChannelMapStore with backend factory
// ---------------------------------------------------------------------------

describe('GlobalChannelMapStore with backend factory', () => {
  beforeEach(() => {
    GlobalChannelMapStore.resetInstance();
  });

  afterEach(() => {
    GlobalChannelMapStore.resetInstance();
  });

  it('should work without a backend factory (default behavior)', () => {
    const store = GlobalChannelMapStore.getInstance();
    const map = store.get('channel-1');
    map.put('key', 'value');
    expect(map.get('key')).toBe('value');
  });

  it('should create backend-aware maps when factory is set', async () => {
    const backends = new Map<string, InMemoryMapBackend>();
    GlobalChannelMapStore.setBackendFactory((channelId) => {
      const backend = new InMemoryMapBackend();
      backends.set(channelId, backend);
      return backend;
    });

    const store = GlobalChannelMapStore.getInstance();
    const map = store.get('channel-1');
    map.put('key', 'value');

    // In-memory read works immediately
    expect(map.get('key')).toBe('value');

    // Backend write is async
    await new Promise((r) => setTimeout(r, 10));
    const backend = backends.get('channel-1')!;
    expect(await backend.get('key')).toBe('value');
  });

  it('should scope backends per channel', async () => {
    const backends = new Map<string, InMemoryMapBackend>();
    GlobalChannelMapStore.setBackendFactory((channelId) => {
      const backend = new InMemoryMapBackend();
      backends.set(channelId, backend);
      return backend;
    });

    const store = GlobalChannelMapStore.getInstance();
    store.get('channel-1').put('key', 'from-1');
    store.get('channel-2').put('key', 'from-2');

    await new Promise((r) => setTimeout(r, 10));

    expect(await backends.get('channel-1')!.get('key')).toBe('from-1');
    expect(await backends.get('channel-2')!.get('key')).toBe('from-2');
  });

  it('should load channel from backend', async () => {
    const backend = new InMemoryMapBackend();
    await backend.set('preloaded', 'data');

    GlobalChannelMapStore.setBackendFactory(() => backend);

    const store = GlobalChannelMapStore.getInstance();
    await store.loadChannelFromBackend('channel-1');

    expect(store.get('channel-1').get('preloaded')).toBe('data');
  });
});
