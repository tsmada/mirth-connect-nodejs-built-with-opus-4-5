import { EnvProvider } from '../../../../src/secrets/providers/EnvProvider.js';

describe('EnvProvider', () => {
  let provider: EnvProvider;
  const savedEnv: Record<string, string | undefined> = {};

  // Keys we set during tests — cleaned up in afterEach
  const testKeys = [
    'DB_PASSWORD',
    'MIRTH_CFG_DB_URL',
    '_MP_DATABASE__URL',
    '_MP_SMTP_HOST',
    'MIRTH_CFG_SMTP_PORT',
    'EXACT_KEY',
  ];

  beforeEach(() => {
    provider = new EnvProvider();
    // Save originals
    for (const key of testKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore originals
    for (const key of testKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  test('name is env', () => {
    expect(provider.name).toBe('env');
  });

  test('initialize is a no-op', async () => {
    await expect(provider.initialize()).resolves.toBeUndefined();
  });

  test('shutdown is a no-op', async () => {
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });

  test('get() returns exact match from process.env', async () => {
    process.env['DB_PASSWORD'] = 'secret123';
    const result = await provider.get('DB_PASSWORD');
    expect(result).toBeDefined();
    expect(result!.value).toBe('secret123');
    expect(result!.source).toBe('env');
    expect(result!.fetchedAt).toBeInstanceOf(Date);
  });

  test('get() returns MIRTH_CFG_ prefixed match', async () => {
    process.env['MIRTH_CFG_DB_URL'] = 'jdbc:mysql://localhost/mirthdb';
    const result = await provider.get('DB_URL');
    expect(result).toBeDefined();
    expect(result!.value).toBe('jdbc:mysql://localhost/mirthdb');
  });

  test('get() returns _MP_ convention match', async () => {
    process.env['_MP_DATABASE__URL'] = 'jdbc:mysql://prod/mirthdb';
    const result = await provider.get('database-url');
    expect(result).toBeDefined();
    expect(result!.value).toBe('jdbc:mysql://prod/mirthdb');
  });

  test('get() prefers exact match over MIRTH_CFG_ prefix', async () => {
    process.env['DB_URL'] = 'exact-value';
    process.env['MIRTH_CFG_DB_URL'] = 'prefixed-value';
    // The key 'DB_URL' matches exactly first
    const result = await provider.get('DB_URL');
    expect(result!.value).toBe('exact-value');
    // Clean up extra key
    delete process.env['DB_URL'];
  });

  test('get() returns undefined for missing key', async () => {
    const result = await provider.get('NONEXISTENT_KEY_12345');
    expect(result).toBeUndefined();
  });

  test('has() returns true for existing key', async () => {
    process.env['EXACT_KEY'] = 'value';
    expect(await provider.has('EXACT_KEY')).toBe(true);
  });

  test('has() returns false for missing key', async () => {
    expect(await provider.has('NONEXISTENT_KEY_12345')).toBe(false);
  });

  test('list() returns MIRTH_CFG_ keys without prefix', async () => {
    process.env['MIRTH_CFG_SMTP_PORT'] = '587';
    const keys = await provider.list();
    expect(keys).toContain('SMTP_PORT');
  });

  test('list() returns _MP_ keys converted to config format', async () => {
    process.env['_MP_SMTP_HOST'] = 'mail.example.com';
    const keys = await provider.list();
    expect(keys).toContain('smtp.host');
  });

  test('list() does not include arbitrary env vars', async () => {
    // PATH, HOME, etc. should not appear in list
    const keys = await provider.list();
    expect(keys).not.toContain('PATH');
    expect(keys).not.toContain('HOME');
  });

  describe('mpEnvToKey static method', () => {
    test('converts _MP_ var with double underscore to hyphen', () => {
      expect(EnvProvider.mpEnvToKey('_MP_DATABASE__URL')).toBe('database-url');
    });

    test('converts _MP_ var with single underscore to dot', () => {
      expect(EnvProvider.mpEnvToKey('_MP_SMTP_HOST')).toBe('smtp.host');
    });

    test('converts to lowercase', () => {
      expect(EnvProvider.mpEnvToKey('_MP_KEYSTORE_PATH')).toBe('keystore.path');
    });

    test('handles mixed separators', () => {
      // _MP_DATABASE__CONNECTION_URL → database-connection.url
      expect(EnvProvider.mpEnvToKey('_MP_DATABASE__CONNECTION_URL')).toBe('database-connection.url');
    });
  });
});
