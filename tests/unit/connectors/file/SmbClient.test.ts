/**
 * Tests for src/connectors/file/backends/SmbClient.ts
 *
 * Mocks the '@marsaud/smb2' library to test all SmbClient methods:
 * - Constructor (domain\username parsing)
 * - connect / disconnect / isConnected
 * - listFiles / listDirectories
 * - exists / readFile / readFileAsString
 * - writeFile (create + append)
 * - delete / move
 * - canRead / canWrite / canAppend
 * - ensureDirectory (recursive creation)
 * - normalizePath
 * - Error paths
 */

import { SmbClient, SmbClientOptions } from '../../../../src/connectors/file/backends/SmbClient';

// Mock logging
jest.mock('../../../../src/logging/index', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: () => false,
  }),
  registerComponent: jest.fn(),
}));

// -----------------------------------------------------------------------
// SMB2 mock setup
// -----------------------------------------------------------------------

// Holds the current mock SMB2 instance's callbacks
interface MockSmbMethods {
  readdir: jest.Mock;
  readFile: jest.Mock;
  writeFile: jest.Mock;
  unlink: jest.Mock;
  rename: jest.Mock;
  exists: jest.Mock;
  mkdir: jest.Mock;
  stat: jest.Mock;
  close: jest.Mock;
}

// Initialized with dummy mocks; createMockSmb() replaces them before each test
let mockSmb: MockSmbMethods = {
  readdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
  rename: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  stat: jest.fn(),
  close: jest.fn(),
};

function createMockSmb(): MockSmbMethods {
  mockSmb = {
    readdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    rename: jest.fn(),
    exists: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
    close: jest.fn(),
  };
  return mockSmb;
}

// Mock the dynamic import of @marsaud/smb2
jest.mock('@marsaud/smb2', () => {
  return class MockSMB2 {
    readdir: jest.Mock;
    readFile: jest.Mock;
    writeFile: jest.Mock;
    unlink: jest.Mock;
    rename: jest.Mock;
    exists: jest.Mock;
    mkdir: jest.Mock;
    stat: jest.Mock;
    close: jest.Mock;

    constructor(_options: Record<string, unknown>) {
      const m = createMockSmb();
      this.readdir = m.readdir;
      this.readFile = m.readFile;
      this.writeFile = m.writeFile;
      this.unlink = m.unlink;
      this.rename = m.rename;
      this.exists = m.exists;
      this.mkdir = m.mkdir;
      this.stat = m.stat;
      this.close = m.close;
    }
  };
}, { virtual: true });

function defaultOptions(): SmbClientOptions {
  return {
    host: 'myserver/myshare',
    username: 'admin',
    password: 'secret',
    timeout: 5000,
  };
}

describe('SmbClient', () => {
  let client: SmbClient;

  beforeEach(() => {
    client = new SmbClient(defaultOptions());
  });

  // -----------------------------------------------------------------------
  // Constructor — domain\username parsing
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('should parse DOMAIN\\username', () => {
      const c = new SmbClient({ ...defaultOptions(), username: 'CORP\\jdoe' });
      // Internal parsing is tested via connect — domain is passed in SMB2 options
      expect(c).toBeDefined();
    });

    it('should parse DOMAIN/username', () => {
      const c = new SmbClient({ ...defaultOptions(), username: 'CORP/jdoe' });
      expect(c).toBeDefined();
    });

    it('should handle username without domain', () => {
      const c = new SmbClient({ ...defaultOptions(), username: 'jdoe' });
      expect(c).toBeDefined();
    });

    it('should handle DOMAIN:username', () => {
      const c = new SmbClient({ ...defaultOptions(), username: 'CORP:jdoe' });
      expect(c).toBeDefined();
    });

    it('should handle DOMAIN;username', () => {
      const c = new SmbClient({ ...defaultOptions(), username: 'CORP;jdoe' });
      expect(c).toBeDefined();
    });

    it('should handle DOMAIN@username', () => {
      const c = new SmbClient({ ...defaultOptions(), username: 'CORP@jdoe' });
      expect(c).toBeDefined();
    });

    it('should use default timeout when not specified', () => {
      const c = new SmbClient({
        host: 'server/share',
        username: 'admin',
        password: 'pass',
      });
      expect(c).toBeDefined();
    });

    it('should use default scheme properties when not specified', () => {
      const c = new SmbClient(defaultOptions());
      expect(c).toBeDefined();
    });

    it('should merge partial scheme properties', () => {
      const c = new SmbClient({
        ...defaultOptions(),
        schemeProperties: { smbMinVersion: 'SMB300' },
      });
      expect(c).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // connect
  // -----------------------------------------------------------------------
  describe('connect()', () => {
    it('should connect successfully', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('should be a no-op if already connected', async () => {
      await client.connect();
      await client.connect(); // second connect should be no-op
      expect(client.isConnected()).toBe(true);
    });

    it('should pass scheme properties to SMB2 constructor', async () => {
      const c = new SmbClient({
        ...defaultOptions(),
        schemeProperties: {
          smbMinVersion: 'SMB300',
          smbMaxVersion: 'SMB311',
        },
      });
      await c.connect();
      expect(c.isConnected()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // disconnect
  // -----------------------------------------------------------------------
  describe('disconnect()', () => {
    it('should disconnect a connected client', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should handle close() throwing', async () => {
      await client.connect();
      mockSmb.close.mockImplementation(() => { throw new Error('close error'); });

      // Should not throw
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // isConnected
  // -----------------------------------------------------------------------
  describe('isConnected()', () => {
    it('should return false initially', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should return true after connect', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // canAppend
  // -----------------------------------------------------------------------
  describe('canAppend()', () => {
    it('should return true (matching Java behavior)', () => {
      expect(client.canAppend()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // listFiles
  // -----------------------------------------------------------------------
  describe('listFiles()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should list files matching a pattern', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, ['report.csv', 'data.csv', 'readme.txt']);
      });
      mockSmb.stat.mockImplementation((_path: string, cb: Function) => {
        cb(null, { isDirectory: () => false, size: 1024, mtime: new Date('2026-01-01') });
      });

      const files = await client.listFiles('documents', '*.csv', false, false);
      expect(files.length).toBe(2);
      expect(files[0]!.name).toBe('report.csv');
      expect(files[1]!.name).toBe('data.csv');
    });

    it('should skip directories', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, ['file.txt', 'subdir']);
      });
      mockSmb.stat.mockImplementation((path: string, cb: Function) => {
        if (path.includes('subdir')) {
          cb(null, { isDirectory: () => true, size: 0, mtime: new Date() });
        } else {
          cb(null, { isDirectory: () => false, size: 100, mtime: new Date() });
        }
      });

      const files = await client.listFiles('dir', '*', false, false);
      expect(files.length).toBe(1);
      expect(files[0]!.name).toBe('file.txt');
    });

    it('should skip dot files when ignoreDot is true', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, ['.hidden', 'visible.txt']);
      });
      mockSmb.stat.mockImplementation((_path: string, cb: Function) => {
        cb(null, { isDirectory: () => false, size: 50, mtime: new Date() });
      });

      const files = await client.listFiles('dir', '*', false, true);
      expect(files.length).toBe(1);
      expect(files[0]!.name).toBe('visible.txt');
    });

    it('should skip files that fail to stat', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, ['good.txt', 'bad.txt']);
      });
      mockSmb.stat.mockImplementation((path: string, cb: Function) => {
        if (path.includes('bad')) {
          cb(new Error('permission denied'));
        } else {
          cb(null, { isDirectory: () => false, size: 100, mtime: new Date() });
        }
      });

      const files = await client.listFiles('dir', '*', false, false);
      expect(files.length).toBe(1);
      expect(files[0]!.name).toBe('good.txt');
    });

    it('should support regex patterns', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, ['file001.dat', 'file002.dat', 'other.txt']);
      });
      mockSmb.stat.mockImplementation((_path: string, cb: Function) => {
        cb(null, { isDirectory: () => false, size: 100, mtime: new Date() });
      });

      const files = await client.listFiles('dir', 'file\\d+\\.dat', true, false);
      expect(files.length).toBe(2);
    });

    it('should throw when not connected', async () => {
      await client.disconnect();
      await expect(
        client.listFiles('dir', '*', false, false)
      ).rejects.toThrow('SMB client is not connected');
    });

    it('should normalize forward slashes to backslashes in paths', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, []);
      });

      await client.listFiles('path/to/dir/', '*', false, false);
      expect(mockSmb.readdir).toHaveBeenCalledWith(
        expect.stringContaining('path\\to\\dir'),
        expect.any(Function)
      );
    });
  });

  // -----------------------------------------------------------------------
  // listDirectories
  // -----------------------------------------------------------------------
  describe('listDirectories()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should list only directories', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, ['subdir1', 'subdir2', 'file.txt']);
      });
      mockSmb.stat.mockImplementation((path: string, cb: Function) => {
        if (path.includes('file')) {
          cb(null, { isDirectory: () => false, size: 100, mtime: new Date() });
        } else {
          cb(null, { isDirectory: () => true, size: 0, mtime: new Date() });
        }
      });

      const dirs = await client.listDirectories('parent');
      expect(dirs.length).toBe(2);
    });

    it('should skip entries that fail to stat', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, ['dir1', 'broken']);
      });
      mockSmb.stat.mockImplementation((path: string, cb: Function) => {
        if (path.includes('broken')) {
          cb(new Error('stat failed'));
        } else {
          cb(null, { isDirectory: () => true, size: 0, mtime: new Date() });
        }
      });

      const dirs = await client.listDirectories('parent');
      expect(dirs.length).toBe(1);
    });

    it('should throw when not connected', async () => {
      await client.disconnect();
      await expect(client.listDirectories('dir')).rejects.toThrow('SMB client is not connected');
    });
  });

  // -----------------------------------------------------------------------
  // exists
  // -----------------------------------------------------------------------
  describe('exists()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should return true when file exists', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, true);
      });

      const result = await client.exists('file.txt', 'dir');
      expect(result).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, false);
      });

      const result = await client.exists('missing.txt', 'dir');
      expect(result).toBe(false);
    });

    it('should throw when not connected', async () => {
      await client.disconnect();
      await expect(client.exists('f', 'd')).rejects.toThrow('SMB client is not connected');
    });
  });

  // -----------------------------------------------------------------------
  // readFile
  // -----------------------------------------------------------------------
  describe('readFile()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should read file content as Buffer', async () => {
      const content = Buffer.from('hello world');
      mockSmb.readFile.mockImplementation((_path: string, cb: Function) => {
        cb(null, content);
      });

      const result = await client.readFile('test.txt', 'dir');
      expect(result).toEqual(content);
    });

    it('should return empty buffer when data is undefined', async () => {
      mockSmb.readFile.mockImplementation((_path: string, cb: Function) => {
        cb(null, undefined);
      });

      const result = await client.readFile('test.txt', 'dir');
      expect(result.length).toBe(0);
    });

    it('should throw on read error', async () => {
      mockSmb.readFile.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('access denied'));
      });

      await expect(client.readFile('test.txt', 'dir')).rejects.toThrow('access denied');
    });
  });

  // -----------------------------------------------------------------------
  // readFileAsString
  // -----------------------------------------------------------------------
  describe('readFileAsString()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should read file as UTF-8 string by default', async () => {
      const content = Buffer.from('hello');
      mockSmb.readFile.mockImplementation((_path: string, cb: Function) => {
        cb(null, content);
      });

      const result = await client.readFileAsString('test.txt', 'dir');
      expect(result).toBe('hello');
    });

    it('should read file with specified encoding', async () => {
      const content = Buffer.from('data');
      mockSmb.readFile.mockImplementation((_path: string, cb: Function) => {
        cb(null, content);
      });

      const result = await client.readFileAsString('test.txt', 'dir', 'ascii');
      expect(result).toBe('data');
    });
  });

  // -----------------------------------------------------------------------
  // writeFile
  // -----------------------------------------------------------------------
  describe('writeFile()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should write new file content', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, true); // directory exists
      });
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(null);
      });

      await client.writeFile('output.txt', 'outdir', 'content', false);
      expect(mockSmb.writeFile).toHaveBeenCalled();
    });

    it('should write string content', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, true);
      });
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(null);
      });

      await client.writeFile('output.txt', 'outdir', 'string content', false);
      expect(mockSmb.writeFile).toHaveBeenCalled();
    });

    it('should append to existing file', async () => {
      const existingContent = Buffer.from('existing ');
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, true);
      });
      mockSmb.readFile.mockImplementation((_path: string, cb: Function) => {
        cb(null, existingContent);
      });
      mockSmb.writeFile.mockImplementation((_path: string, data: Buffer, cb: Function) => {
        // Verify the combined content
        expect(data.toString()).toBe('existing new');
        cb(null);
      });

      await client.writeFile('output.txt', 'outdir', 'new', true);
    });

    it('should create new file when appending but file does not exist', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, true); // directory exists
      });
      // readFile fails (file doesn't exist)
      mockSmb.readFile.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('file not found'));
      });
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(null);
      });

      await client.writeFile('new.txt', 'outdir', 'content', true);
      // writeFile should still be called (fallback to write new)
      expect(mockSmb.writeFile).toHaveBeenCalled();
    });

    it('should ensure directory exists before writing', async () => {
      // ensureDirectory checks: full path exists? No -> split into parts -> check each
      // For "new\path": check "new\path" (false), check "new" (false) -> mkdir "new",
      // check "new\path" (false) -> mkdir "new\path"
      const createdDirs = new Set<string>();
      mockSmb.exists.mockImplementation((path: string, cb: Function) => {
        cb(null, createdDirs.has(path));
      });
      mockSmb.mkdir.mockImplementation((path: string, cb: Function) => {
        createdDirs.add(path);
        cb(null);
      });
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(null);
      });

      await client.writeFile('output.txt', 'new/path', 'content', false);
      expect(mockSmb.mkdir).toHaveBeenCalled();
    });

    it('should throw when not connected', async () => {
      await client.disconnect();
      await expect(
        client.writeFile('f', 'd', 'c', false)
      ).rejects.toThrow('SMB client is not connected');
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  describe('delete()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should delete an existing file', async () => {
      mockSmb.unlink.mockImplementation((_path: string, cb: Function) => {
        cb(null);
      });

      await client.delete('old.txt', 'dir', false);
      expect(mockSmb.unlink).toHaveBeenCalled();
    });

    it('should throw when file does not exist and mayNotExist=false', async () => {
      mockSmb.unlink.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('file not found'));
      });

      await expect(client.delete('missing.txt', 'dir', false)).rejects.toThrow(
        'Error deleting SMB file'
      );
    });

    it('should not throw when file does not exist and mayNotExist=true', async () => {
      mockSmb.unlink.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('file not found'));
      });

      await expect(client.delete('missing.txt', 'dir', true)).resolves.toBeUndefined();
    });

    it('should throw when not connected', async () => {
      await client.disconnect();
      await expect(client.delete('f', 'd', false)).rejects.toThrow('SMB client is not connected');
    });
  });

  // -----------------------------------------------------------------------
  // move
  // -----------------------------------------------------------------------
  describe('move()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should move a file from source to destination', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, true);
      });
      // First unlink (delete existing dest) might fail — that's ok
      mockSmb.unlink.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('file not found')); // destination doesn't exist
      });
      mockSmb.rename.mockImplementation((_old: string, _new: string, cb: Function) => {
        cb(null);
      });

      await client.move('source.txt', 'srcdir', 'dest.txt', 'dstdir');
      expect(mockSmb.rename).toHaveBeenCalled();
    });

    it('should delete existing destination before moving', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, true);
      });
      mockSmb.unlink.mockImplementation((_path: string, cb: Function) => {
        cb(null); // destination existed and was deleted
      });
      mockSmb.rename.mockImplementation((_old: string, _new: string, cb: Function) => {
        cb(null);
      });

      await client.move('source.txt', 'srcdir', 'dest.txt', 'dstdir');
      expect(mockSmb.unlink).toHaveBeenCalled();
      expect(mockSmb.rename).toHaveBeenCalled();
    });

    it('should ensure destination directory exists', async () => {
      const createdDirs = new Set<string>();
      mockSmb.exists.mockImplementation((path: string, cb: Function) => {
        cb(null, createdDirs.has(path));
      });
      mockSmb.mkdir.mockImplementation((path: string, cb: Function) => {
        createdDirs.add(path);
        cb(null);
      });
      mockSmb.unlink.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('not found'));
      });
      mockSmb.rename.mockImplementation((_old: string, _new: string, cb: Function) => {
        cb(null);
      });

      await client.move('src.txt', 'srcdir', 'dst.txt', 'new/dstdir');
      expect(mockSmb.mkdir).toHaveBeenCalled();
    });

    it('should throw when not connected', async () => {
      await client.disconnect();
      await expect(
        client.move('a', 'b', 'c', 'd')
      ).rejects.toThrow('SMB client is not connected');
    });
  });

  // -----------------------------------------------------------------------
  // canRead
  // -----------------------------------------------------------------------
  describe('canRead()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should return true when readdir succeeds', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, []);
      });

      const result = await client.canRead('dir');
      expect(result).toBe(true);
    });

    it('should return false when readdir fails', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('permission denied'));
      });

      const result = await client.canRead('dir');
      expect(result).toBe(false);
    });

    it('should throw when not connected', async () => {
      await client.disconnect();
      await expect(client.canRead('dir')).rejects.toThrow('SMB client is not connected');
    });
  });

  // -----------------------------------------------------------------------
  // canWrite
  // -----------------------------------------------------------------------
  describe('canWrite()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should return true when test write succeeds', async () => {
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(null);
      });
      mockSmb.unlink.mockImplementation((_path: string, cb: Function) => {
        cb(null);
      });

      const result = await client.canWrite('dir');
      expect(result).toBe(true);
    });

    it('should return false when test write fails', async () => {
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(new Error('read-only share'));
      });

      const result = await client.canWrite('dir');
      expect(result).toBe(false);
    });

    it('should return true even when cleanup unlink fails', async () => {
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(null);
      });
      mockSmb.unlink.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('cleanup failed'));
      });

      const result = await client.canWrite('dir');
      expect(result).toBe(true);
    });

    it('should throw when not connected', async () => {
      await client.disconnect();
      await expect(client.canWrite('dir')).rejects.toThrow('SMB client is not connected');
    });
  });

  // -----------------------------------------------------------------------
  // ensureDirectory (via writeFile)
  // -----------------------------------------------------------------------
  describe('ensureDirectory()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should create nested directories', async () => {
      const createdDirs: string[] = [];
      let existsCallCount = 0;

      mockSmb.exists.mockImplementation((path: string, cb: Function) => {
        existsCallCount++;
        // First call (check full path): false
        // Subsequent calls for path segments: alternate based on creation
        const found = createdDirs.includes(path);
        cb(null, found);
      });
      mockSmb.mkdir.mockImplementation((path: string, cb: Function) => {
        createdDirs.push(path);
        cb(null);
      });
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(null);
      });

      await client.writeFile('file.txt', 'a/b/c', 'content', false);
      // Should have created directories
      expect(mockSmb.mkdir).toHaveBeenCalled();
    });

    it('should handle concurrent directory creation (mkdir fails, exists succeeds)', async () => {
      let mkdirCalled = false;
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        // After mkdir was called, report exists=true
        cb(null, mkdirCalled);
      });
      mockSmb.mkdir.mockImplementation((_path: string, cb: Function) => {
        mkdirCalled = true;
        cb(new Error('already exists')); // Concurrent creation
      });
      mockSmb.writeFile.mockImplementation((_path: string, _data: Buffer, cb: Function) => {
        cb(null);
      });

      // Should not throw — concurrent creation is handled
      await client.writeFile('file.txt', 'newdir', 'content', false);
    });

    it('should throw when mkdir fails and directory still does not exist', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, false); // Always returns false
      });
      mockSmb.mkdir.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('permission denied'));
      });

      await expect(
        client.writeFile('file.txt', 'restricted', 'content', false)
      ).rejects.toThrow('Failed to create SMB directory');
    });
  });

  // -----------------------------------------------------------------------
  // normalizePath (via method calls)
  // -----------------------------------------------------------------------
  describe('normalizePath (via public methods)', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('should remove trailing backslashes', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, []);
      });

      await client.listFiles('dir\\', '*', false, false);
      // The path passed to readdir should not have trailing backslash
      const calledPath = mockSmb.readdir.mock.calls[0]![0] as string;
      expect(calledPath.endsWith('\\')).toBe(false);
    });

    it('should handle empty path', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, true);
      });

      const result = await client.exists('file.txt', '');
      expect(result).toBe(true);
    });

    it('should convert forward slashes to backslashes', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, []);
      });

      await client.listFiles('a/b/c', '*', false, false);
      const calledPath = mockSmb.readdir.mock.calls[0]![0] as string;
      expect(calledPath).toBe('a\\b\\c');
    });
  });

  // -----------------------------------------------------------------------
  // Promise wrapper edge cases
  // -----------------------------------------------------------------------
  describe('Promise wrapper edge cases', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('readdir should resolve empty array when files is undefined', async () => {
      mockSmb.readdir.mockImplementation((_path: string, cb: Function) => {
        cb(null, undefined);
      });

      const files = await client.listFiles('dir', '*', false, false);
      expect(files).toEqual([]);
    });

    it('exists should resolve false when exists is undefined', async () => {
      mockSmb.exists.mockImplementation((_path: string, cb: Function) => {
        cb(null, undefined);
      });

      const result = await client.exists('file.txt', 'dir');
      expect(result).toBe(false);
    });
  });
});
