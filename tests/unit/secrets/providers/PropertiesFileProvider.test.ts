import { PropertiesFileProvider } from '../../../../src/secrets/providers/PropertiesFileProvider.js';
import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PropertiesFileProvider', () => {
  const tmpFile = join(tmpdir(), `mirth-props-test-${process.pid}.properties`);

  afterEach(() => {
    try {
      rmSync(tmpFile, { force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  describe('parse()', () => {
    test('parses key=value pairs', () => {
      const result = PropertiesFileProvider.parse('db.host=localhost\ndb.port=3306');
      expect(result.get('db.host')).toBe('localhost');
      expect(result.get('db.port')).toBe('3306');
    });

    test('parses key: value pairs (colon separator)', () => {
      const result = PropertiesFileProvider.parse('db.host: localhost\ndb.port: 3306');
      expect(result.get('db.host')).toBe('localhost');
      expect(result.get('db.port')).toBe('3306');
    });

    test('parses key value pairs (space separator)', () => {
      const result = PropertiesFileProvider.parse('db.host localhost\ndb.port 3306');
      expect(result.get('db.host')).toBe('localhost');
      expect(result.get('db.port')).toBe('3306');
    });

    test('skips # comments', () => {
      const result = PropertiesFileProvider.parse('# This is a comment\ndb.host=localhost');
      expect(result.size).toBe(1);
      expect(result.get('db.host')).toBe('localhost');
    });

    test('skips ! comments', () => {
      const result = PropertiesFileProvider.parse('! This is also a comment\ndb.host=localhost');
      expect(result.size).toBe(1);
      expect(result.get('db.host')).toBe('localhost');
    });

    test('skips blank lines', () => {
      const result = PropertiesFileProvider.parse('\n\ndb.host=localhost\n\ndb.port=3306\n\n');
      expect(result.size).toBe(2);
    });

    test('strips double-quoted values', () => {
      const result = PropertiesFileProvider.parse('greeting="hello world"');
      expect(result.get('greeting')).toBe('hello world');
    });

    test('strips single-quoted values', () => {
      const result = PropertiesFileProvider.parse("path='/usr/local/bin'");
      expect(result.get('path')).toBe('/usr/local/bin');
    });

    test('trims whitespace from keys and values', () => {
      const result = PropertiesFileProvider.parse('  db.host  =  localhost  ');
      expect(result.get('db.host')).toBe('localhost');
    });

    test('handles values containing = sign', () => {
      const result = PropertiesFileProvider.parse('url=jdbc:mysql://host:3306/db?useSSL=true');
      expect(result.get('url')).toBe('jdbc:mysql://host:3306/db?useSSL=true');
    });

    test('handles values containing : character', () => {
      const result = PropertiesFileProvider.parse('url=http://host:8080/path');
      expect(result.get('url')).toBe('http://host:8080/path');
    });

    test('prefers = or : separator over whitespace', () => {
      // "key with spaces=value" should split at =, not at the first space
      const result = PropertiesFileProvider.parse('complex.key=value with spaces');
      expect(result.get('complex.key')).toBe('value with spaces');
    });
  });

  describe('provider lifecycle', () => {
    test('initialize loads file and populates properties', async () => {
      writeFileSync(tmpFile, 'db.password=secret123\napi.key=abc-def\n');
      const provider = new PropertiesFileProvider(tmpFile);
      await provider.initialize();

      const result = await provider.get('db.password');
      expect(result).toBeDefined();
      expect(result!.value).toBe('secret123');
      expect(result!.source).toBe('props');
    });

    test('initialize with missing file logs warning and continues', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const provider = new PropertiesFileProvider('/nonexistent/file.properties');
      await provider.initialize();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PropertiesFileProvider] Failed to read')
      );
      warnSpy.mockRestore();

      // Provider should still work, just empty
      expect(await provider.list()).toEqual([]);
    });

    test('get() returns undefined before initialize', async () => {
      writeFileSync(tmpFile, 'key=value');
      const provider = new PropertiesFileProvider(tmpFile);
      // Don't call initialize
      const result = await provider.get('key');
      expect(result).toBeUndefined();
    });

    test('get() returns undefined for missing key', async () => {
      writeFileSync(tmpFile, 'key=value');
      const provider = new PropertiesFileProvider(tmpFile);
      await provider.initialize();
      expect(await provider.get('missing')).toBeUndefined();
    });

    test('has() returns true for existing key', async () => {
      writeFileSync(tmpFile, 'db.password=secret');
      const provider = new PropertiesFileProvider(tmpFile);
      await provider.initialize();
      expect(await provider.has('db.password')).toBe(true);
    });

    test('has() returns false for missing key', async () => {
      writeFileSync(tmpFile, 'db.password=secret');
      const provider = new PropertiesFileProvider(tmpFile);
      await provider.initialize();
      expect(await provider.has('nonexistent')).toBe(false);
    });

    test('list() returns all keys', async () => {
      writeFileSync(tmpFile, 'alpha=1\nbeta=2\ngamma=3');
      const provider = new PropertiesFileProvider(tmpFile);
      await provider.initialize();
      const keys = await provider.list();
      expect(keys).toEqual(['alpha', 'beta', 'gamma']);
    });

    test('name is props', () => {
      const provider = new PropertiesFileProvider(tmpFile);
      expect(provider.name).toBe('props');
    });

    test('shutdown is a no-op', async () => {
      const provider = new PropertiesFileProvider(tmpFile);
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });
  });
});
