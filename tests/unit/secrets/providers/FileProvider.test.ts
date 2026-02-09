import { FileProvider } from '../../../../src/secrets/providers/FileProvider.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileProvider', () => {
  let tmpDir: string;
  let provider: FileProvider;
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ['DB_PASSWORD_FILE', 'API_KEY_FILE'];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mirth-file-provider-'));
    provider = new FileProvider(tmpDir);

    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore env
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }

    // Clean up temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  test('name is file', () => {
    expect(provider.name).toBe('file');
  });

  test('initialize does not throw when directory exists', async () => {
    await expect(provider.initialize()).resolves.toBeUndefined();
  });

  test('initialize does not throw when directory is missing', async () => {
    const missingProvider = new FileProvider('/nonexistent/path/12345');
    await expect(missingProvider.initialize()).resolves.toBeUndefined();
  });

  test('get() reads direct file from basePath', async () => {
    writeFileSync(join(tmpDir, 'DB_PASSWORD'), 'super-secret');
    const result = await provider.get('DB_PASSWORD');
    expect(result).toBeDefined();
    expect(result!.value).toBe('super-secret');
    expect(result!.source).toBe('file');
    expect(result!.fetchedAt).toBeInstanceOf(Date);
  });

  test('get() strips trailing newline from file content', async () => {
    writeFileSync(join(tmpDir, 'API_KEY'), 'key-value-123\n');
    const result = await provider.get('API_KEY');
    expect(result!.value).toBe('key-value-123');
  });

  test('get() does not strip internal newlines', async () => {
    writeFileSync(join(tmpDir, 'MULTI_LINE'), 'line1\nline2\n');
    const result = await provider.get('MULTI_LINE');
    // Only trailing newline stripped; internal newlines preserved
    expect(result!.value).toBe('line1\nline2');
  });

  test('get() reads from _FILE suffix env var', async () => {
    const secretFile = join(tmpDir, 'external-secret.txt');
    writeFileSync(secretFile, 'from-env-file-ref\n');
    process.env['DB_PASSWORD_FILE'] = secretFile;

    // Use a separate provider with a different basePath to prove _FILE is used
    const otherProvider = new FileProvider('/nonexistent');
    const result = await otherProvider.get('DB_PASSWORD');
    expect(result).toBeDefined();
    expect(result!.value).toBe('from-env-file-ref');
  });

  test('get() prefers _FILE env var over direct file', async () => {
    // Both exist: _FILE env var and direct file
    writeFileSync(join(tmpDir, 'API_KEY'), 'from-direct-file');
    const externalFile = join(tmpDir, 'external-api-key.txt');
    writeFileSync(externalFile, 'from-file-env-var');
    process.env['API_KEY_FILE'] = externalFile;

    const result = await provider.get('API_KEY');
    expect(result!.value).toBe('from-file-env-var');
  });

  test('get() returns undefined for missing key', async () => {
    const result = await provider.get('NONEXISTENT_SECRET');
    expect(result).toBeUndefined();
  });

  test('has() returns true when file exists', async () => {
    writeFileSync(join(tmpDir, 'EXISTS'), 'yes');
    expect(await provider.has('EXISTS')).toBe(true);
  });

  test('has() returns false when file is missing', async () => {
    expect(await provider.has('DOES_NOT_EXIST')).toBe(false);
  });

  test('list() returns directory contents', async () => {
    writeFileSync(join(tmpDir, 'SECRET_A'), 'a');
    writeFileSync(join(tmpDir, 'SECRET_B'), 'b');
    const keys = await provider.list();
    expect(keys).toContain('SECRET_A');
    expect(keys).toContain('SECRET_B');
    expect(keys).toHaveLength(2);
  });

  test('list() returns empty array when directory is missing', async () => {
    const missingProvider = new FileProvider('/nonexistent/path/12345');
    const keys = await missingProvider.list();
    expect(keys).toEqual([]);
  });

  test('shutdown is a no-op', async () => {
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});
