/**
 * Coverage tests for FileReceiver — exercises poll(), listLocalFiles(),
 * filterFiles(), sortFiles(), processFile(), readFile(), readLocalFile(),
 * executePostAction(), deleteFile(), moveFile(), start/stop lifecycle,
 * and SFTP/backend paths via mocks.
 *
 * These tests mock fs/promises and SFTP/backend clients to test the full
 * poll pipeline without real filesystem I/O.
 */

import * as path from 'path';
import { FileReceiver } from '../../../../src/connectors/file/FileReceiver';
import {
  FileScheme,
  AfterProcessingAction,
  FileSortBy,
  FileInfo,
} from '../../../../src/connectors/file/FileConnectorProperties';

// ─── Mock fs/promises ──────────────────────────────────────────────────

const mockStat = jest.fn();
const mockReaddir = jest.fn();
const mockReadFile = jest.fn();
const mockUnlink = jest.fn();
const mockRename = jest.fn();
const mockMkdir = jest.fn();

jest.mock('fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

// ─── Mock logging ──────────────────────────────────────────────────────

jest.mock('../../../../src/logging/index', () => ({
  registerComponent: jest.fn(),
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: jest.fn().mockReturnValue(false),
  })),
}));

// ─── Mock SftpConnection ───────────────────────────────────────────────

const mockSftpConnect = jest.fn();
const mockSftpDisconnect = jest.fn();
const mockSftpCanRead = jest.fn();
const mockSftpListFiles = jest.fn();
const mockSftpListDirectories = jest.fn();
const mockSftpReadFile = jest.fn();
const mockSftpReadFileAsString = jest.fn();
const mockSftpDelete = jest.fn();
const mockSftpMove = jest.fn();
const mockSftpIsConnected = jest.fn();

jest.mock('../../../../src/connectors/file/sftp/SftpConnection', () => ({
  SftpConnection: jest.fn().mockImplementation(() => ({
    connect: mockSftpConnect,
    disconnect: mockSftpDisconnect,
    canRead: mockSftpCanRead,
    listFiles: mockSftpListFiles,
    listDirectories: mockSftpListDirectories,
    readFile: mockSftpReadFile,
    readFileAsString: mockSftpReadFileAsString,
    delete: mockSftpDelete,
    move: mockSftpMove,
    isConnected: mockSftpIsConnected,
  })),
}));

// ─── Mock backend factory ──────────────────────────────────────────────

const mockBackendConnect = jest.fn();
const mockBackendDisconnect = jest.fn();
const mockBackendCanRead = jest.fn();
const mockBackendListFiles = jest.fn();
const mockBackendListDirectories = jest.fn();
const mockBackendReadFile = jest.fn();
const mockBackendReadFileAsString = jest.fn();
const mockBackendDelete = jest.fn();
const mockBackendMove = jest.fn();
const mockBackendIsConnected = jest.fn();

jest.mock('../../../../src/connectors/file/backends/factory', () => ({
  createFileSystemClient: jest.fn(() => ({
    connect: mockBackendConnect,
    disconnect: mockBackendDisconnect,
    canRead: mockBackendCanRead,
    listFiles: mockBackendListFiles,
    listDirectories: mockBackendListDirectories,
    readFile: mockBackendReadFile,
    readFileAsString: mockBackendReadFileAsString,
    delete: mockBackendDelete,
    move: mockBackendMove,
    isConnected: mockBackendIsConnected,
  })),
}));

// ─── Mock SourceConnector.dispatchRawMessage ────────────────────────────

// We mock dispatchRawMessage on the prototype to prevent actual message processing
const mockDispatchRawMessage = jest.fn().mockResolvedValue(undefined);
const mockDispatchConnectionEvent = jest.fn();

// ─── Helpers ───────────────────────────────────────────────────────────

function createFileInfo(
  name: string,
  directory: string,
  size: number,
  ageMs: number
): FileInfo {
  return {
    name,
    path: path.join(directory, name),
    directory,
    size,
    lastModified: new Date(Date.now() - ageMs),
    isDirectory: false,
  };
}

/** Set up mock filesystem for local FILE scheme */
function setupLocalFs(files: FileInfo[]) {
  mockStat.mockImplementation(async (p: string) => {
    // For directory check
    const fileMatch = files.find(f => f.path === p);
    if (fileMatch) {
      return { isDirectory: () => false, size: fileMatch.size, mtime: fileMatch.lastModified };
    }
    // For the root directory
    return { isDirectory: () => true };
  });

  mockReaddir.mockImplementation(async () =>
    files.map(f => ({
      name: f.name,
      isDirectory: () => false,
      isFile: () => true,
    }))
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('FileReceiver coverage', () => {
  let receiver: FileReceiver;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    receiver = new FileReceiver({
      name: 'Test File Reader',
      properties: {
        scheme: FileScheme.FILE,
        directory: '/data/input',
        fileFilter: '*',
        regex: false,
        pollInterval: 5000,
        checkFileAge: false,
        fileAge: 0,
        batchSize: 0,
        sortBy: FileSortBy.DATE,
        sortDescending: false,
      },
    });

    // Override dispatchRawMessage and dispatchConnectionEvent on the instance
    (receiver as any).dispatchRawMessage = mockDispatchRawMessage;
    (receiver as any).dispatchConnectionEvent = mockDispatchConnectionEvent;
  });

  afterEach(async () => {
    jest.useRealTimers();
    // Ensure receiver is stopped
    if (receiver.isRunning()) {
      // Override running to allow clean stop
      (receiver as any).running = false;
    }
  });

  // ── start() lifecycle ─────────────────────────────────────────────

  describe('start() lifecycle', () => {
    it('should start and begin polling for local filesystem', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      mockReaddir.mockResolvedValue([]);

      await receiver.start();

      expect(receiver.isRunning()).toBe(true);
      expect(mockDispatchConnectionEvent).toHaveBeenCalled();

      // Stop to clean up
      await receiver.stop();
    });

    it('should throw when starting an already running receiver', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      mockReaddir.mockResolvedValue([]);

      await receiver.start();

      await expect(receiver.start()).rejects.toThrow('already running');

      await receiver.stop();
    });

    it('should throw when directory is empty', async () => {
      receiver.setProperties({ directory: '' });

      await expect(receiver.start()).rejects.toThrow('Directory is required');
    });

    it('should throw when local path is not a directory', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => false });

      await expect(receiver.start()).rejects.toThrow('not a directory');
    });

    it('should throw when local directory does not exist', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockStat.mockRejectedValue(err);

      await expect(receiver.start()).rejects.toThrow('Directory not found');
    });

    it('should re-throw other stat errors', async () => {
      mockStat.mockRejectedValue(new Error('Permission denied'));

      await expect(receiver.start()).rejects.toThrow('Permission denied');
    });

    it('should throw for unknown file scheme', async () => {
      receiver.setProperties({ scheme: 'UNKNOWN' as FileScheme });

      await expect(receiver.start()).rejects.toThrow('Unknown file scheme');
    });
  });

  // ── stop() lifecycle ──────────────────────────────────────────────

  describe('stop() lifecycle', () => {
    it('should stop a running receiver', async () => {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      mockReaddir.mockResolvedValue([]);

      await receiver.start();
      expect(receiver.isRunning()).toBe(true);

      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });

    it('should be safe to stop a non-running receiver', async () => {
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });

    it('should disconnect SFTP on stop', async () => {
      receiver.setProperties({
        scheme: FileScheme.SFTP,
        host: 'sftp.example.com',
        maxRetryCount: 0,
      });

      mockSftpConnect.mockResolvedValue(undefined);
      mockSftpCanRead.mockResolvedValue(true);
      mockSftpListFiles.mockResolvedValue([]);
      mockSftpListDirectories.mockResolvedValue([]);
      mockSftpIsConnected.mockReturnValue(true);
      mockSftpDisconnect.mockResolvedValue(undefined);

      await receiver.start();
      await receiver.stop();

      expect(mockSftpDisconnect).toHaveBeenCalled();
    });

    it('should disconnect backend client on stop', async () => {
      receiver.setProperties({
        scheme: FileScheme.FTP,
        host: 'ftp.example.com',
        maxRetryCount: 0,
      });

      mockBackendConnect.mockResolvedValue(undefined);
      mockBackendCanRead.mockResolvedValue(true);
      mockBackendListFiles.mockResolvedValue([]);
      mockBackendListDirectories.mockResolvedValue([]);
      mockBackendIsConnected.mockReturnValue(true);
      mockBackendDisconnect.mockResolvedValue(undefined);

      await receiver.start();
      await receiver.stop();

      expect(mockBackendDisconnect).toHaveBeenCalled();
    });
  });

  // ── poll() with local files ───────────────────────────────────────

  describe('poll() with local files', () => {
    it('should list, filter, sort and process files', async () => {
      const files = [
        createFileInfo('a.xml', '/data/input', 100, 5000),
        createFileInfo('b.xml', '/data/input', 200, 3000),
      ];

      setupLocalFs(files);
      mockReadFile.mockResolvedValue('file content');

      mockStat.mockResolvedValue({ isDirectory: () => true });
      // After start, mock readdir for poll
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      // Stat for file info
      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });

      await receiver.start();

      // Wait for the first poll (immediate execution)
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(2);

      await receiver.stop();
    });

    it('should apply file filter pattern', async () => {
      receiver.setProperties({ fileFilter: '*.hl7', regex: false });

      const files = [
        createFileInfo('a.hl7', '/data/input', 100, 5000),
        createFileInfo('b.xml', '/data/input', 200, 5000),
        createFileInfo('c.hl7', '/data/input', 150, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('hl7 content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Only .hl7 files should be dispatched (2 of 3)
      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(2);

      await receiver.stop();
    });

    it('should apply regex file filter', async () => {
      receiver.setProperties({ fileFilter: 'file_\\d{4}\\.xml', regex: true });

      const files = [
        createFileInfo('file_0001.xml', '/data/input', 100, 5000),
        createFileInfo('file_abcd.xml', '/data/input', 200, 5000),
        createFileInfo('file_0002.xml', '/data/input', 150, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('xml content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(2);

      await receiver.stop();
    });

    it('should check file age when enabled', async () => {
      receiver.setProperties({ checkFileAge: true, fileAge: 10000 });

      const files = [
        createFileInfo('old.xml', '/data/input', 100, 20000), // 20s old, passes
        createFileInfo('new.xml', '/data/input', 200, 1000),  // 1s old, too young
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Only old.xml should pass age filter
      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(1);

      await receiver.stop();
    });

    it('should check file size minimum', async () => {
      receiver.setProperties({ fileSizeMinimum: '150' });

      const files = [
        createFileInfo('small.xml', '/data/input', 50, 5000),
        createFileInfo('large.xml', '/data/input', 200, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(1);

      await receiver.stop();
    });

    it('should check file size maximum when not ignored', async () => {
      receiver.setProperties({
        ignoreFileSizeMaximum: false,
        fileSizeMaximum: '100',
      });

      const files = [
        createFileInfo('small.xml', '/data/input', 50, 5000),
        createFileInfo('large.xml', '/data/input', 200, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Only small.xml should pass
      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(1);

      await receiver.stop();
    });

    it('should ignore file size maximum when ignoreFileSizeMaximum is true', async () => {
      receiver.setProperties({
        ignoreFileSizeMaximum: true,
        fileSizeMaximum: '100',
      });

      const files = [
        createFileInfo('big.xml', '/data/input', 9999, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(1);

      await receiver.stop();
    });
  });

  // ── sortFiles() ───────────────────────────────────────────────────

  describe('sort files', () => {
    it('should sort by name ascending', async () => {
      receiver.setProperties({ sortBy: FileSortBy.NAME, sortDescending: false });

      const files = [
        createFileInfo('c.xml', '/data/input', 100, 5000),
        createFileInfo('a.xml', '/data/input', 200, 5000),
        createFileInfo('b.xml', '/data/input', 150, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // First dispatched should be 'a.xml'
      const firstCall = mockDispatchRawMessage.mock.calls[0];
      const firstSourceMap = firstCall![1] as Map<string, unknown>;
      expect(firstSourceMap.get('originalFilename')).toBe('a.xml');

      await receiver.stop();
    });

    it('should sort by size ascending', async () => {
      receiver.setProperties({ sortBy: FileSortBy.SIZE, sortDescending: false });

      const files = [
        createFileInfo('big.xml', '/data/input', 300, 5000),
        createFileInfo('small.xml', '/data/input', 100, 5000),
        createFileInfo('med.xml', '/data/input', 200, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      const firstSourceMap = mockDispatchRawMessage.mock.calls[0]![1] as Map<string, unknown>;
      expect(firstSourceMap.get('originalFilename')).toBe('small.xml');

      await receiver.stop();
    });

    it('should sort descending', async () => {
      receiver.setProperties({ sortBy: FileSortBy.NAME, sortDescending: true });

      const files = [
        createFileInfo('a.xml', '/data/input', 100, 5000),
        createFileInfo('c.xml', '/data/input', 100, 5000),
        createFileInfo('b.xml', '/data/input', 100, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      const firstSourceMap = mockDispatchRawMessage.mock.calls[0]![1] as Map<string, unknown>;
      expect(firstSourceMap.get('originalFilename')).toBe('c.xml');

      await receiver.stop();
    });
  });

  // ── batchSize limiting ────────────────────────────────────────────

  describe('batch size', () => {
    it('should limit files processed per poll to batchSize', async () => {
      receiver.setProperties({ batchSize: 2 });

      const files = [
        createFileInfo('a.xml', '/data/input', 100, 5000),
        createFileInfo('b.xml', '/data/input', 100, 4000),
        createFileInfo('c.xml', '/data/input', 100, 3000),
        createFileInfo('d.xml', '/data/input', 100, 2000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Only 2 should be processed
      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(2);

      await receiver.stop();
    });
  });

  // ── processFile() sourceMap entries ────────────────────────────────

  describe('processFile sourceMap entries', () => {
    it('should include pollId, pollSequenceId, and pollComplete', async () => {
      const files = [
        createFileInfo('only.xml', '/data/input', 100, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      const sourceMap = mockDispatchRawMessage.mock.calls[0]![1] as Map<string, unknown>;
      expect(sourceMap.get('originalFilename')).toBe('only.xml');
      expect(sourceMap.get('fileDirectory')).toBe('/data/input');
      expect(sourceMap.get('fileSize')).toBe(100);
      expect(sourceMap.get('pollId')).toBeDefined();
      expect(sourceMap.get('pollSequenceId')).toBe(1);
      expect(sourceMap.get('pollComplete')).toBe(true); // Only file = last file

      await receiver.stop();
    });

    it('should set pollComplete only on the last file', async () => {
      const files = [
        createFileInfo('first.xml', '/data/input', 100, 5000),
        createFileInfo('second.xml', '/data/input', 100, 4000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // First file should NOT have pollComplete
      const sourceMap1 = mockDispatchRawMessage.mock.calls[0]![1] as Map<string, unknown>;
      expect(sourceMap1.has('pollComplete')).toBe(false);

      // Second file should have pollComplete
      const sourceMap2 = mockDispatchRawMessage.mock.calls[1]![1] as Map<string, unknown>;
      expect(sourceMap2.get('pollComplete')).toBe(true);

      await receiver.stop();
    });
  });

  // ── readFile binary mode ──────────────────────────────────────────

  describe('readFile modes', () => {
    it('should read as base64 in binary mode', async () => {
      receiver.setProperties({ binary: true });

      const files = [createFileInfo('bin.dat', '/data/input', 10, 5000)];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue(Buffer.from([0xDE, 0xAD]));

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Binary mode calls readFile without encoding
      expect(mockReadFile).toHaveBeenCalledWith(path.join('/data/input', 'bin.dat'));

      // Content should be base64
      const content = mockDispatchRawMessage.mock.calls[0]![0] as string;
      expect(content).toBe(Buffer.from([0xDE, 0xAD]).toString('base64'));

      await receiver.stop();
    });

    it('should read as text in non-binary mode', async () => {
      receiver.setProperties({ binary: false, charsetEncoding: 'UTF-8' });

      const files = [createFileInfo('text.xml', '/data/input', 10, 5000)];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('text content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockReadFile).toHaveBeenCalledWith(
        path.join('/data/input', 'text.xml'),
        { encoding: 'UTF-8' }
      );

      await receiver.stop();
    });
  });

  // ── executePostAction ─────────────────────────────────────────────

  describe('after processing actions', () => {
    it('should delete file when afterProcessingAction is DELETE', async () => {
      receiver.setProperties({
        afterProcessingAction: AfterProcessingAction.DELETE,
      });

      const files = [createFileInfo('del.xml', '/data/input', 100, 5000)];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');
      mockUnlink.mockResolvedValue(undefined);

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockUnlink).toHaveBeenCalledWith(path.join('/data/input', 'del.xml'));

      await receiver.stop();
    });

    it('should move file when afterProcessingAction is MOVE', async () => {
      receiver.setProperties({
        afterProcessingAction: AfterProcessingAction.MOVE,
        moveToDirectory: '/data/processed',
      });

      const files = [createFileInfo('mv.xml', '/data/input', 100, 5000)];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');
      mockMkdir.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockMkdir).toHaveBeenCalledWith('/data/processed', { recursive: true });
      expect(mockRename).toHaveBeenCalledWith(
        path.join('/data/input', 'mv.xml'),
        path.join('/data/processed', 'mv.xml')
      );

      await receiver.stop();
    });

    it('should use moveToFileName when provided', async () => {
      receiver.setProperties({
        afterProcessingAction: AfterProcessingAction.MOVE,
        moveToDirectory: '/data/processed',
        moveToFileName: 'renamed.xml',
      });

      const files = [createFileInfo('orig.xml', '/data/input', 100, 5000)];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');
      mockMkdir.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockRename).toHaveBeenCalledWith(
        path.join('/data/input', 'orig.xml'),
        path.join('/data/processed', 'renamed.xml')
      );

      await receiver.stop();
    });

    it('should use error fields when readError occurs', async () => {
      receiver.setProperties({
        errorReadingAction: AfterProcessingAction.MOVE,
        errorMoveToDirectory: '/data/errors',
        errorMoveToFileName: 'error.xml',
      });

      const files = [createFileInfo('bad.xml', '/data/input', 100, 5000)];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockRejectedValue(new Error('Read error'));
      mockMkdir.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Should use error fields
      expect(mockRename).toHaveBeenCalledWith(
        path.join('/data/input', 'bad.xml'),
        path.join('/data/errors', 'error.xml')
      );

      await receiver.stop();
    });

    it('should not act when afterProcessingAction is NONE', async () => {
      receiver.setProperties({
        afterProcessingAction: AfterProcessingAction.NONE,
      });

      const files = [createFileInfo('keep.xml', '/data/input', 100, 5000)];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockUnlink).not.toHaveBeenCalled();
      expect(mockRename).not.toHaveBeenCalled();

      await receiver.stop();
    });
  });

  // ── Hidden files filtering ────────────────────────────────────────

  describe('hidden files filtering', () => {
    it('should skip hidden files when ignoreDot is true', async () => {
      receiver.setProperties({ ignoreDot: true });

      const files = [
        createFileInfo('visible.xml', '/data/input', 100, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue([
        { name: '.hidden', isDirectory: () => false, isFile: () => true },
        { name: 'visible.xml', isDirectory: () => false, isFile: () => true },
      ]);
      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Only visible.xml should be dispatched
      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(1);

      await receiver.stop();
    });
  });

  // ── Directory recursion ───────────────────────────────────────────

  describe('directory recursion', () => {
    it('should recurse into subdirectories when enabled', async () => {
      receiver.setProperties({ directoryRecursion: true });

      mockStat.mockImplementation(async (p: string) => {
        if (p === '/data/input/sub/nested.xml') {
          return { isDirectory: () => false, size: 50, mtime: new Date(Date.now() - 5000) };
        }
        if (p === '/data/input/top.xml') {
          return { isDirectory: () => false, size: 100, mtime: new Date(Date.now() - 5000) };
        }
        return { isDirectory: () => true };
      });

      mockReaddir
        .mockResolvedValueOnce([
          { name: 'top.xml', isDirectory: () => false, isFile: () => true },
          { name: 'sub', isDirectory: () => true, isFile: () => false },
        ])
        .mockResolvedValueOnce([
          { name: 'nested.xml', isDirectory: () => false, isFile: () => true },
        ]);

      mockReadFile.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Both top.xml and nested.xml should be processed
      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(2);

      await receiver.stop();
    });
  });

  // ── SFTP scheme paths ─────────────────────────────────────────────

  describe('SFTP scheme', () => {
    beforeEach(() => {
      receiver.setProperties({
        scheme: FileScheme.SFTP,
        host: 'sftp.example.com',
        directory: '/remote/input',
        maxRetryCount: 0,
      });

      mockSftpConnect.mockResolvedValue(undefined);
      mockSftpCanRead.mockResolvedValue(true);
      mockSftpIsConnected.mockReturnValue(true);
      mockSftpDisconnect.mockResolvedValue(undefined);
    });

    it('should list and read SFTP files', async () => {
      const sftpFiles = [
        { name: 'remote.xml', path: '/remote/input/remote.xml', directory: '/remote/input', size: 100, lastModified: new Date(Date.now() - 5000), isDirectory: false },
      ];
      mockSftpListFiles.mockResolvedValue(sftpFiles);
      mockSftpListDirectories.mockResolvedValue([]);
      mockSftpReadFileAsString.mockResolvedValue('sftp content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(1);
      expect(mockSftpReadFileAsString).toHaveBeenCalledWith('remote.xml', '/remote/input', 'UTF-8');

      await receiver.stop();
    });

    it('should read SFTP binary files as base64', async () => {
      receiver.setProperties({ binary: true });

      const sftpFiles = [
        { name: 'bin.dat', path: '/remote/input/bin.dat', directory: '/remote/input', size: 10, lastModified: new Date(Date.now() - 5000), isDirectory: false },
      ];
      mockSftpListFiles.mockResolvedValue(sftpFiles);
      mockSftpListDirectories.mockResolvedValue([]);
      mockSftpReadFile.mockResolvedValue(Buffer.from([0xCA, 0xFE]));

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockSftpReadFile).toHaveBeenCalledWith('bin.dat', '/remote/input');
      const content = mockDispatchRawMessage.mock.calls[0]![0] as string;
      expect(content).toBe(Buffer.from([0xCA, 0xFE]).toString('base64'));

      await receiver.stop();
    });

    it('should delete SFTP files', async () => {
      receiver.setProperties({ afterProcessingAction: AfterProcessingAction.DELETE });

      mockSftpListFiles.mockResolvedValue([
        { name: 'del.xml', path: '/remote/input/del.xml', directory: '/remote/input', size: 100, lastModified: new Date(Date.now() - 5000), isDirectory: false },
      ]);
      mockSftpListDirectories.mockResolvedValue([]);
      mockSftpReadFileAsString.mockResolvedValue('content');
      mockSftpDelete.mockResolvedValue(undefined);

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockSftpDelete).toHaveBeenCalledWith('del.xml', '/remote/input', false);

      await receiver.stop();
    });

    it('should move SFTP files', async () => {
      receiver.setProperties({
        afterProcessingAction: AfterProcessingAction.MOVE,
        moveToDirectory: '/remote/processed',
      });

      mockSftpListFiles.mockResolvedValue([
        { name: 'mv.xml', path: '/remote/input/mv.xml', directory: '/remote/input', size: 100, lastModified: new Date(Date.now() - 5000), isDirectory: false },
      ]);
      mockSftpListDirectories.mockResolvedValue([]);
      mockSftpReadFileAsString.mockResolvedValue('content');
      mockSftpMove.mockResolvedValue(undefined);

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockSftpMove).toHaveBeenCalledWith('mv.xml', '/remote/input', 'mv.xml', '/remote/processed');

      await receiver.stop();
    });

    it('should recurse SFTP directories', async () => {
      receiver.setProperties({ directoryRecursion: true });

      mockSftpListFiles
        .mockResolvedValueOnce([
          { name: 'top.xml', path: '/remote/input/top.xml', directory: '/remote/input', size: 100, lastModified: new Date(Date.now() - 5000), isDirectory: false },
        ])
        .mockResolvedValueOnce([
          { name: 'sub.xml', path: '/remote/input/sub/sub.xml', directory: '/remote/input/sub', size: 50, lastModified: new Date(Date.now() - 5000), isDirectory: false },
        ]);
      mockSftpListDirectories
        .mockResolvedValueOnce(['/remote/input/sub'])
        .mockResolvedValueOnce([]);
      mockSftpReadFileAsString.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(2);

      await receiver.stop();
    });
  });

  // ── Backend (FTP/S3/SMB) scheme paths ─────────────────────────────

  describe('backend scheme (FTP)', () => {
    beforeEach(() => {
      receiver.setProperties({
        scheme: FileScheme.FTP,
        host: 'ftp.example.com',
        directory: '/remote/input',
        maxRetryCount: 0,
      });

      mockBackendConnect.mockResolvedValue(undefined);
      mockBackendCanRead.mockResolvedValue(true);
      mockBackendIsConnected.mockReturnValue(true);
      mockBackendDisconnect.mockResolvedValue(undefined);
    });

    it('should list and read backend files', async () => {
      mockBackendListFiles.mockResolvedValue([
        { name: 'ftp.xml', path: '/remote/input/ftp.xml', directory: '/remote/input', size: 100, lastModified: new Date(Date.now() - 5000), isDirectory: false },
      ]);
      mockBackendListDirectories.mockResolvedValue([]);
      mockBackendReadFileAsString.mockResolvedValue('ftp content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(1);

      await receiver.stop();
    });

    it('should read backend binary files', async () => {
      receiver.setProperties({ binary: true });

      mockBackendListFiles.mockResolvedValue([
        { name: 'bin.dat', path: '/remote/input/bin.dat', directory: '/remote/input', size: 10, lastModified: new Date(Date.now() - 5000), isDirectory: false },
      ]);
      mockBackendListDirectories.mockResolvedValue([]);
      mockBackendReadFile.mockResolvedValue(Buffer.from([0xBE, 0xEF]));

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockBackendReadFile).toHaveBeenCalledWith('bin.dat', '/remote/input');

      await receiver.stop();
    });

    it('should delete backend files', async () => {
      receiver.setProperties({ afterProcessingAction: AfterProcessingAction.DELETE });

      mockBackendListFiles.mockResolvedValue([
        { name: 'del.xml', path: '/remote/input/del.xml', directory: '/remote/input', size: 100, lastModified: new Date(Date.now() - 5000), isDirectory: false },
      ]);
      mockBackendListDirectories.mockResolvedValue([]);
      mockBackendReadFileAsString.mockResolvedValue('content');
      mockBackendDelete.mockResolvedValue(undefined);

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockBackendDelete).toHaveBeenCalledWith('del.xml', '/remote/input', false);

      await receiver.stop();
    });

    it('should move backend files', async () => {
      receiver.setProperties({
        afterProcessingAction: AfterProcessingAction.MOVE,
        moveToDirectory: '/remote/processed',
      });

      mockBackendListFiles.mockResolvedValue([
        { name: 'mv.xml', path: '/remote/input/mv.xml', directory: '/remote/input', size: 100, lastModified: new Date(Date.now() - 5000), isDirectory: false },
      ]);
      mockBackendListDirectories.mockResolvedValue([]);
      mockBackendReadFileAsString.mockResolvedValue('content');
      mockBackendMove.mockResolvedValue(undefined);

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockBackendMove).toHaveBeenCalledWith('mv.xml', '/remote/input', 'mv.xml', '/remote/processed');

      await receiver.stop();
    });

    it('should recurse backend directories', async () => {
      receiver.setProperties({ directoryRecursion: true });

      mockBackendListFiles
        .mockResolvedValueOnce([
          { name: 'top.xml', path: '/remote/input/top.xml', directory: '/remote/input', size: 100, lastModified: new Date(Date.now() - 5000), isDirectory: false },
        ])
        .mockResolvedValueOnce([
          { name: 'sub.xml', path: '/remote/input/sub/sub.xml', directory: '/remote/input/sub', size: 50, lastModified: new Date(Date.now() - 5000), isDirectory: false },
        ]);
      mockBackendListDirectories
        .mockResolvedValueOnce(['/remote/input/sub'])
        .mockResolvedValueOnce([]);
      mockBackendReadFileAsString.mockResolvedValue('content');

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDispatchRawMessage).toHaveBeenCalledTimes(2);

      await receiver.stop();
    });
  });

  // ── SFTP retry logic ──────────────────────────────────────────────

  describe('SFTP retry logic', () => {
    it('should retry SFTP connection on failure', async () => {
      receiver.setProperties({
        scheme: FileScheme.SFTP,
        host: 'sftp.example.com',
        maxRetryCount: 2,
        retryDelay: 10, // Short delay for tests
      });

      mockSftpConnect
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);
      mockSftpCanRead.mockResolvedValue(true);
      mockSftpIsConnected.mockReturnValue(true);
      mockSftpListFiles.mockResolvedValue([]);
      mockSftpListDirectories.mockResolvedValue([]);
      mockSftpDisconnect.mockResolvedValue(undefined);

      jest.useRealTimers(); // Need real timers for retry delay

      await receiver.start();
      expect(receiver.isRunning()).toBe(true);

      // Connect should have been called twice (1 failure + 1 success)
      expect(mockSftpConnect).toHaveBeenCalledTimes(2);

      await receiver.stop();
      jest.useFakeTimers();
    }, 10000);

    it('should throw after exhausting retries', async () => {
      receiver.setProperties({
        scheme: FileScheme.SFTP,
        host: 'sftp.example.com',
        maxRetryCount: 1,
        retryDelay: 10,
      });

      mockSftpConnect.mockRejectedValue(new Error('Connection refused'));
      mockSftpCanRead.mockResolvedValue(true);
      mockSftpDisconnect.mockResolvedValue(undefined);

      jest.useRealTimers();

      await expect(receiver.start()).rejects.toThrow('Connection refused');

      jest.useFakeTimers();
    }, 10000);
  });

  // ── S3 scheme (no host required) ──────────────────────────────────

  describe('S3 scheme', () => {
    it('should not require host for S3', async () => {
      receiver.setProperties({
        scheme: FileScheme.S3,
        host: '', // No host needed for S3
        directory: 'my-bucket/prefix',
        maxRetryCount: 0,
      });

      mockBackendConnect.mockResolvedValue(undefined);
      mockBackendCanRead.mockResolvedValue(true);
      mockBackendIsConnected.mockReturnValue(true);
      mockBackendListFiles.mockResolvedValue([]);
      mockBackendListDirectories.mockResolvedValue([]);
      mockBackendDisconnect.mockResolvedValue(undefined);

      await receiver.start();
      expect(receiver.isRunning()).toBe(true);

      await receiver.stop();
    });
  });

  // ── poll error handling ───────────────────────────────────────────

  describe('poll error handling', () => {
    it('should not crash on poll error', async () => {
      mockStat.mockImplementation(async (_p: string) => {
        return { isDirectory: () => true };
      });
      mockReaddir.mockRejectedValue(new Error('Permission denied'));

      await receiver.start();
      await jest.advanceTimersByTimeAsync(0);

      // Should still be running despite poll error
      expect(receiver.isRunning()).toBe(true);

      await receiver.stop();
    });

    it('should not poll when not running', async () => {
      // Access private poll method directly
      const poll = (receiver as any).poll.bind(receiver);

      await poll();

      // No dispatch calls since not running
      expect(mockDispatchConnectionEvent).not.toHaveBeenCalled();
    });
  });

  // ── Event dispatching pattern ─────────────────────────────────────

  describe('event dispatching', () => {
    it('should dispatch POLLING at start of poll, READING per file, IDLE after', async () => {
      const files = [
        createFileInfo('a.xml', '/data/input', 100, 5000),
      ];

      mockStat.mockImplementation(async (p: string) => {
        const file = files.find(f => f.path === p);
        if (file) {
          return { isDirectory: () => false, size: file.size, mtime: file.lastModified };
        }
        return { isDirectory: () => true };
      });
      mockReaddir.mockResolvedValue(
        files.map(f => ({
          name: f.name,
          isDirectory: () => false,
          isFile: () => true,
        }))
      );
      mockReadFile.mockResolvedValue('content');

      await receiver.start();

      // Let the immediate poll() and any microtasks settle
      await jest.advanceTimersByTimeAsync(0);
      // Additional tick to ensure all async work in poll() is done
      await Promise.resolve();
      await Promise.resolve();

      // Collect ALL events since start (including IDLE from start + poll events)
      const events = mockDispatchConnectionEvent.mock.calls.map(c => c[0]);
      // start() dispatches IDLE, then poll() dispatches POLLING, READING, IDLE, IDLE
      expect(events).toContain('IDLE');
      expect(events).toContain('POLLING');
      expect(events).toContain('READING');

      await receiver.stop();
    });
  });
});
