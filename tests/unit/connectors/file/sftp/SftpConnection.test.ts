/**
 * Unit tests for SftpConnection
 *
 * Tests SFTP file operations using mocked ssh2-sftp-client
 */

import { SftpConnection, SftpConnectionOptions } from '../../../../../src/connectors/file/sftp/SftpConnection';
import {
  SftpSchemeProperties,
  getDefaultSftpSchemeProperties,
  validateSftpSchemeProperties,
} from '../../../../../src/connectors/file/sftp/SftpSchemeProperties';

// Mock ssh2-sftp-client
jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(true),
    list: jest.fn().mockResolvedValue([]),
    stat: jest.fn().mockResolvedValue({ isDirectory: true }),
    get: jest.fn().mockResolvedValue(Buffer.from('file content')),
    put: jest.fn().mockResolvedValue('OK'),
    delete: jest.fn().mockResolvedValue('OK'),
    rename: jest.fn().mockResolvedValue('OK'),
    mkdir: jest.fn().mockResolvedValue('OK'),
    isConnected: jest.fn().mockReturnValue(true),
  }));
});

// Mock fs for key file reading
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('mock-private-key'),
}));

describe('SftpSchemeProperties', () => {
  describe('getDefaultSftpSchemeProperties', () => {
    it('should return correct default values', () => {
      const defaults = getDefaultSftpSchemeProperties();

      expect(defaults.passwordAuth).toBe(true);
      expect(defaults.keyAuth).toBe(false);
      expect(defaults.keyFile).toBe('');
      expect(defaults.passPhrase).toBe('');
      expect(defaults.hostKeyChecking).toBe('ask');
      expect(defaults.knownHostsFile).toBe('');
      expect(defaults.configurationSettings).toEqual({});
    });
  });

  describe('validateSftpSchemeProperties', () => {
    it('should pass with password auth enabled', () => {
      const props: SftpSchemeProperties = {
        ...getDefaultSftpSchemeProperties(),
        passwordAuth: true,
      };

      expect(() => validateSftpSchemeProperties(props)).not.toThrow();
    });

    it('should pass with key auth enabled and keyFile set', () => {
      const props: SftpSchemeProperties = {
        ...getDefaultSftpSchemeProperties(),
        passwordAuth: false,
        keyAuth: true,
        keyFile: '/path/to/key',
      };

      expect(() => validateSftpSchemeProperties(props)).not.toThrow();
    });

    it('should throw if no auth method enabled', () => {
      const props: SftpSchemeProperties = {
        ...getDefaultSftpSchemeProperties(),
        passwordAuth: false,
        keyAuth: false,
      };

      expect(() => validateSftpSchemeProperties(props)).toThrow(
        'At least one authentication method'
      );
    });

    it('should throw if key auth enabled but no keyFile', () => {
      const props: SftpSchemeProperties = {
        ...getDefaultSftpSchemeProperties(),
        passwordAuth: false,
        keyAuth: true,
        keyFile: '',
      };

      expect(() => validateSftpSchemeProperties(props)).toThrow(
        'Key file path is required'
      );
    });
  });
});

describe('SftpConnection', () => {
  let connection: SftpConnection;
  let mockClient: any;

  const defaultOptions: SftpConnectionOptions = {
    host: 'sftp.example.com',
    port: 22,
    username: 'testuser',
    password: 'testpass',
    timeout: 10000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const SftpClient = require('ssh2-sftp-client');
    mockClient = new SftpClient();
    connection = new SftpConnection(defaultOptions);
    // Replace the internal client with our mock
    (connection as any).client = mockClient;
  });

  describe('connect', () => {
    it('should connect with password authentication', async () => {
      await connection.connect();

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'sftp.example.com',
          port: 22,
          username: 'testuser',
          password: 'testpass',
        })
      );
    });

    it('should connect with key authentication', async () => {
      const keyOptions: SftpConnectionOptions = {
        ...defaultOptions,
        schemeProperties: {
          passwordAuth: false,
          keyAuth: true,
          keyFile: '/path/to/key',
          passPhrase: 'keypass',
          hostKeyChecking: 'yes',
          knownHostsFile: '',
          configurationSettings: {},
        },
      };

      connection = new SftpConnection(keyOptions);
      (connection as any).client = mockClient;

      await connection.connect();

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: 'mock-private-key',
          passphrase: 'keypass',
        })
      );
    });

    it('should skip host verification when hostKeyChecking is "no"', async () => {
      const noCheckOptions: SftpConnectionOptions = {
        ...defaultOptions,
        schemeProperties: {
          ...getDefaultSftpSchemeProperties(),
          hostKeyChecking: 'no',
        },
      };

      connection = new SftpConnection(noCheckOptions);
      (connection as any).client = mockClient;

      await connection.connect();

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          hostVerifier: expect.any(Function),
        })
      );

      // Verify the hostVerifier returns true (skips verification)
      const connectConfig = mockClient.connect.mock.calls[0][0];
      expect(connectConfig.hostVerifier()).toBe(true);
    });

    it('should not reconnect if already connected', async () => {
      await connection.connect();
      mockClient.connect.mockClear();

      await connection.connect();

      expect(mockClient.connect).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should end the connection', async () => {
      await connection.connect();
      await connection.disconnect();

      expect(mockClient.end).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      await expect(connection.disconnect()).resolves.not.toThrow();
    });
  });

  describe('isConnected', () => {
    it('should return connection status', async () => {
      expect(connection.isConnected()).toBe(false);

      await connection.connect();
      expect(connection.isConnected()).toBe(true);
    });
  });

  describe('listFiles', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should list files from directory', async () => {
      mockClient.list.mockResolvedValue([
        {
          type: '-',
          name: 'file1.txt',
          size: 1024,
          modifyTime: Date.now(),
          rights: { user: 'rw', group: 'r', other: 'r' },
          owner: 1000,
          group: 1000,
        },
        {
          type: '-',
          name: 'file2.txt',
          size: 2048,
          modifyTime: Date.now(),
          rights: { user: 'rw', group: 'r', other: '' },
          owner: 1000,
          group: 1000,
        },
      ]);

      const files = await connection.listFiles('/remote/dir');

      expect(files).toHaveLength(2);
      expect(files[0]?.name).toBe('file1.txt');
      expect(files[1]?.name).toBe('file2.txt');
      expect(files[0]?.directory).toBe('/remote/dir');
    });

    it('should filter out directories', async () => {
      mockClient.list.mockResolvedValue([
        { type: '-', name: 'file.txt', size: 100, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
        { type: 'd', name: 'subdir', size: 0, modifyTime: Date.now(), rights: { user: 'rwx', group: 'rx', other: 'rx' }, owner: 1000, group: 1000 },
        { type: 'l', name: 'link', size: 0, modifyTime: Date.now(), rights: { user: 'rwx', group: 'rx', other: 'rx' }, owner: 1000, group: 1000 },
      ]);

      const files = await connection.listFiles('/remote/dir');

      expect(files).toHaveLength(1);
      expect(files[0]?.name).toBe('file.txt');
    });

    it('should filter files by glob pattern', async () => {
      mockClient.list.mockResolvedValue([
        { type: '-', name: 'data.csv', size: 100, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
        { type: '-', name: 'report.pdf', size: 200, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
        { type: '-', name: 'backup.csv', size: 150, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
      ]);

      const files = await connection.listFiles('/remote/dir', '*.csv', false, false);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.name)).toEqual(['data.csv', 'backup.csv']);
    });

    it('should filter files by regex pattern', async () => {
      mockClient.list.mockResolvedValue([
        { type: '-', name: 'msg_001.hl7', size: 100, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
        { type: '-', name: 'msg_002.hl7', size: 200, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
        { type: '-', name: 'other.txt', size: 150, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
      ]);

      const files = await connection.listFiles('/remote/dir', 'msg_\\d+\\.hl7', true, false);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.name)).toEqual(['msg_001.hl7', 'msg_002.hl7']);
    });

    it('should ignore dot files when ignoreDot is true', async () => {
      mockClient.list.mockResolvedValue([
        { type: '-', name: '.hidden', size: 100, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
        { type: '-', name: 'visible.txt', size: 200, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
      ]);

      const files = await connection.listFiles('/remote/dir', '*', false, true);

      expect(files).toHaveLength(1);
      expect(files[0]?.name).toBe('visible.txt');
    });
  });

  describe('listDirectories', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should list directories', async () => {
      mockClient.list.mockResolvedValue([
        { type: '-', name: 'file.txt', size: 100, modifyTime: Date.now(), rights: { user: 'rw', group: 'r', other: 'r' }, owner: 1000, group: 1000 },
        { type: 'd', name: 'subdir1', size: 0, modifyTime: Date.now(), rights: { user: 'rwx', group: 'rx', other: 'rx' }, owner: 1000, group: 1000 },
        { type: 'd', name: 'subdir2', size: 0, modifyTime: Date.now(), rights: { user: 'rwx', group: 'rx', other: 'rx' }, owner: 1000, group: 1000 },
      ]);

      const dirs = await connection.listDirectories('/remote/dir');

      expect(dirs).toHaveLength(2);
      expect(dirs).toContain('/remote/dir/subdir1');
      expect(dirs).toContain('/remote/dir/subdir2');
    });
  });

  describe('exists', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should return true when file exists', async () => {
      mockClient.stat.mockResolvedValue({ isDirectory: false });

      const result = await connection.exists('file.txt', '/remote/dir');

      expect(result).toBe(true);
      expect(mockClient.stat).toHaveBeenCalledWith('/remote/dir/file.txt');
    });

    it('should return false when file does not exist', async () => {
      mockClient.stat.mockRejectedValue(new Error('No such file'));

      const result = await connection.exists('missing.txt', '/remote/dir');

      expect(result).toBe(false);
    });
  });

  describe('readFile', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should read file content as Buffer', async () => {
      const content = Buffer.from('Hello, World!');
      mockClient.get.mockResolvedValue(content);

      const result = await connection.readFile('test.txt', '/remote/dir');

      expect(result).toEqual(content);
      expect(mockClient.get).toHaveBeenCalledWith('/remote/dir/test.txt');
    });

    it('should handle string result from get()', async () => {
      mockClient.get.mockResolvedValue('Hello, World!');

      const result = await connection.readFile('test.txt', '/remote/dir');

      expect(result).toEqual(Buffer.from('Hello, World!'));
    });
  });

  describe('readFileAsString', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should read file content as string', async () => {
      const content = Buffer.from('Hello, World!');
      mockClient.get.mockResolvedValue(content);

      const result = await connection.readFileAsString('test.txt', '/remote/dir');

      expect(result).toBe('Hello, World!');
    });

    it('should use specified encoding', async () => {
      const content = Buffer.from('Hello', 'utf16le');
      mockClient.get.mockResolvedValue(content);

      const result = await connection.readFileAsString('test.txt', '/remote/dir', 'utf16le');

      expect(result).toBe('Hello');
    });
  });

  describe('writeFile', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should write Buffer to file', async () => {
      const content = Buffer.from('Test content');

      await connection.writeFile('output.txt', '/remote/dir', content);

      expect(mockClient.put).toHaveBeenCalledWith(content, '/remote/dir/output.txt');
    });

    it('should write string to file', async () => {
      await connection.writeFile('output.txt', '/remote/dir', 'Test content');

      expect(mockClient.put).toHaveBeenCalledWith(
        Buffer.from('Test content'),
        '/remote/dir/output.txt'
      );
    });

    it('should append to existing file when append is true', async () => {
      const existing = Buffer.from('Existing ');
      const newContent = Buffer.from('content');
      mockClient.get.mockResolvedValue(existing);

      await connection.writeFile('output.txt', '/remote/dir', newContent, true);

      expect(mockClient.get).toHaveBeenCalledWith('/remote/dir/output.txt');
      expect(mockClient.put).toHaveBeenCalledWith(
        Buffer.concat([existing, newContent]),
        '/remote/dir/output.txt'
      );
    });

    it('should create new file on append when file does not exist', async () => {
      const error = new Error('No such file');
      mockClient.get.mockRejectedValue(error);

      const content = Buffer.from('New content');
      await connection.writeFile('output.txt', '/remote/dir', content, true);

      expect(mockClient.put).toHaveBeenCalledWith(content, '/remote/dir/output.txt');
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should delete file', async () => {
      await connection.delete('file.txt', '/remote/dir');

      expect(mockClient.delete).toHaveBeenCalledWith('/remote/dir/file.txt');
    });

    it('should throw error when file not found and mayNotExist is false', async () => {
      mockClient.delete.mockRejectedValue(new Error('No such file'));

      await expect(
        connection.delete('missing.txt', '/remote/dir', false)
      ).rejects.toThrow('No such file');
    });

    it('should not throw error when file not found and mayNotExist is true', async () => {
      mockClient.delete.mockRejectedValue(new Error('No such file'));

      await expect(
        connection.delete('missing.txt', '/remote/dir', true)
      ).resolves.not.toThrow();
    });
  });

  describe('move', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should move file to new location', async () => {
      mockClient.stat.mockResolvedValue({ isDirectory: true });
      mockClient.delete.mockRejectedValue(new Error('No such file')); // Dest doesn't exist

      await connection.move('source.txt', '/remote/from', 'dest.txt', '/remote/to');

      expect(mockClient.rename).toHaveBeenCalledWith(
        '/remote/from/source.txt',
        '/remote/to/dest.txt'
      );
    });

    it('should delete existing destination before move', async () => {
      mockClient.stat.mockResolvedValue({ isDirectory: true });
      mockClient.delete.mockResolvedValue('OK');

      await connection.move('source.txt', '/remote/from', 'dest.txt', '/remote/to');

      expect(mockClient.delete).toHaveBeenCalledWith('/remote/to/dest.txt');
      expect(mockClient.rename).toHaveBeenCalled();
    });
  });

  describe('ensureDirectory', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should do nothing if directory exists', async () => {
      mockClient.stat.mockResolvedValue({ isDirectory: true });

      await connection.ensureDirectory('/remote/existing');

      expect(mockClient.mkdir).not.toHaveBeenCalled();
    });

    it('should create directory if it does not exist', async () => {
      mockClient.stat
        .mockRejectedValueOnce(new Error('No such file'))
        .mockRejectedValueOnce(new Error('No such file'));

      await connection.ensureDirectory('/remote/new');

      expect(mockClient.mkdir).toHaveBeenCalled();
    });

    it('should create nested directories', async () => {
      // The implementation walks through each path segment
      // First, the full path check fails
      mockClient.stat.mockRejectedValue(new Error('No such file'));

      await connection.ensureDirectory('/remote/parent/child');

      // Should have attempted to create directories
      expect(mockClient.mkdir).toHaveBeenCalled();
    });
  });

  describe('canRead', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should return true when directory is readable', async () => {
      mockClient.list.mockResolvedValue([]);

      const result = await connection.canRead('/remote/dir');

      expect(result).toBe(true);
    });

    it('should return false when directory is not readable', async () => {
      mockClient.list.mockRejectedValue(new Error('Permission denied'));

      const result = await connection.canRead('/remote/dir');

      expect(result).toBe(false);
    });
  });

  describe('canWrite', () => {
    beforeEach(async () => {
      await connection.connect();
    });

    it('should return true when directory is writable', async () => {
      mockClient.list.mockResolvedValue([]);

      const result = await connection.canWrite('/remote/dir');

      expect(result).toBe(true);
    });

    it('should return false when directory is not writable', async () => {
      mockClient.list.mockRejectedValue(new Error('Permission denied'));

      const result = await connection.canWrite('/remote/dir');

      expect(result).toBe(false);
    });
  });
});
