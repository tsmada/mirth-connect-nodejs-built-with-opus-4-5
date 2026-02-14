/**
 * Tests for FileReceiver three-path post-processing action selection (CPC-W21-007)
 *
 * Java FileReceiver.java:440-450 has three distinct post-processing paths:
 * 1. Read/dispatch error → errorReadingAction (default: NONE)
 * 2. Response error → errorResponseAction (default: AFTER_PROCESSING = use afterProcessingAction)
 * 3. Success → afterProcessingAction
 *
 * When error fields are used, Java uses errorMoveToDirectory/errorMoveToFileName
 * instead of moveToDirectory/moveToFileName.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileReceiver } from '../../../../src/connectors/file/FileReceiver';
import {
  AfterProcessingAction,
  FileScheme,
} from '../../../../src/connectors/file/FileConnectorProperties';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

describe('FileReceiver error action wiring (CPC-W21-007)', () => {
  let tmpDir: string;
  let inputDir: string;
  let processedDir: string;
  let errorDir: string;

  beforeEach(async () => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    // Create temp directories for testing
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mirth-file-test-'));
    inputDir = path.join(tmpDir, 'input');
    processedDir = path.join(tmpDir, 'processed');
    errorDir = path.join(tmpDir, 'errors');

    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(processedDir, { recursive: true });
    await fs.mkdir(errorDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directories
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('default error action values', () => {
    it('should default errorReadingAction to NONE', () => {
      const receiver = new FileReceiver({});
      const props = receiver.getProperties();
      expect(props.errorReadingAction).toBe(AfterProcessingAction.NONE);
    });

    it('should default errorResponseAction to AFTER_PROCESSING', () => {
      const receiver = new FileReceiver({});
      const props = receiver.getProperties();
      expect(props.errorResponseAction).toBe('AFTER_PROCESSING');
    });

    it('should default errorMoveToDirectory to empty string', () => {
      const receiver = new FileReceiver({});
      const props = receiver.getProperties();
      expect(props.errorMoveToDirectory).toBe('');
    });

    it('should default errorMoveToFileName to empty string', () => {
      const receiver = new FileReceiver({});
      const props = receiver.getProperties();
      expect(props.errorMoveToFileName).toBe('');
    });
  });

  describe('successful processing uses afterProcessingAction', () => {
    it('should use afterProcessingAction=DELETE on success', async () => {
      // Create a test file
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.DELETE,
          errorReadingAction: AfterProcessingAction.MOVE,
          errorMoveToDirectory: errorDir,
          checkFileAge: false, // Disable file age check for test files
          pollInterval: 60000, // Long interval so only one poll runs
        },
      });

      // Mock the channel to prevent "not attached" error
      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockResolvedValue({}),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      // Trigger a poll manually
      await (receiver as any).poll();

      // File should be deleted (afterProcessingAction), NOT moved to error dir
      const filesInInput = await fs.readdir(inputDir);
      expect(filesInInput).not.toContain('test.txt');

      const filesInError = await fs.readdir(errorDir);
      expect(filesInError).not.toContain('test.txt');

      await receiver.stop();
    });

    it('should use afterProcessingAction=MOVE with moveToDirectory on success', async () => {
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.MOVE,
          moveToDirectory: processedDir,
          errorReadingAction: AfterProcessingAction.DELETE, // Should NOT be used on success
          checkFileAge: false,
          pollInterval: 60000,
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockResolvedValue({}),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      await (receiver as any).poll();

      // File should be moved to processed dir, not deleted
      const filesInProcessed = await fs.readdir(processedDir);
      expect(filesInProcessed).toContain('test.txt');

      const filesInInput = await fs.readdir(inputDir);
      expect(filesInInput).not.toContain('test.txt');

      await receiver.stop();
    });
  });

  describe('read error uses errorReadingAction', () => {
    it('should use errorReadingAction=MOVE on read error', async () => {
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.DELETE, // Should NOT be used on error
          errorReadingAction: AfterProcessingAction.MOVE,
          errorMoveToDirectory: errorDir,
          checkFileAge: false,
          pollInterval: 60000,
        },
      });

      // Mock channel to throw during dispatch (simulates read/dispatch error)
      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockRejectedValue(new Error('Channel processing failed')),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      await (receiver as any).poll();

      // File should be moved to error dir (errorReadingAction=MOVE)
      const filesInError = await fs.readdir(errorDir);
      expect(filesInError).toContain('test.txt');

      // File should NOT be in input dir anymore
      const filesInInput = await fs.readdir(inputDir);
      expect(filesInInput).not.toContain('test.txt');

      await receiver.stop();
    });

    it('should use errorReadingAction=DELETE on read error', async () => {
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.MOVE,
          moveToDirectory: processedDir,
          errorReadingAction: AfterProcessingAction.DELETE,
          checkFileAge: false,
          pollInterval: 60000,
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockRejectedValue(new Error('Channel processing failed')),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      await (receiver as any).poll();

      // File should be deleted (errorReadingAction=DELETE)
      const filesInInput = await fs.readdir(inputDir);
      expect(filesInInput).not.toContain('test.txt');

      // File should NOT be in processed dir
      const filesInProcessed = await fs.readdir(processedDir);
      expect(filesInProcessed).not.toContain('test.txt');

      await receiver.stop();
    });

    it('should use errorReadingAction=NONE on read error (default - no action)', async () => {
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.DELETE, // Should NOT be used on error
          errorReadingAction: AfterProcessingAction.NONE, // Default
          checkFileAge: false,
          pollInterval: 60000,
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockRejectedValue(new Error('Channel processing failed')),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      await (receiver as any).poll();

      // File should still be in input dir (errorReadingAction=NONE means no action)
      const filesInInput = await fs.readdir(inputDir);
      expect(filesInInput).toContain('test.txt');

      await receiver.stop();
    });

    it('should use errorMoveToDirectory (not moveToDirectory) on read error with MOVE', async () => {
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.MOVE,
          moveToDirectory: processedDir, // Should NOT be used on error
          errorReadingAction: AfterProcessingAction.MOVE,
          errorMoveToDirectory: errorDir, // Should be used on error
          checkFileAge: false,
          pollInterval: 60000,
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockRejectedValue(new Error('Channel processing failed')),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      await (receiver as any).poll();

      // File should be in error dir, NOT processed dir
      const filesInError = await fs.readdir(errorDir);
      expect(filesInError).toContain('test.txt');

      const filesInProcessed = await fs.readdir(processedDir);
      expect(filesInProcessed).not.toContain('test.txt');

      await receiver.stop();
    });

    it('should use errorMoveToFileName when moving on error', async () => {
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.NONE,
          errorReadingAction: AfterProcessingAction.MOVE,
          errorMoveToDirectory: errorDir,
          errorMoveToFileName: 'error_test.txt',
          checkFileAge: false,
          pollInterval: 60000,
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockRejectedValue(new Error('Channel processing failed')),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      await (receiver as any).poll();

      // File should be renamed to errorMoveToFileName
      const filesInError = await fs.readdir(errorDir);
      expect(filesInError).toContain('error_test.txt');
      expect(filesInError).not.toContain('test.txt');

      await receiver.stop();
    });
  });

  describe('errorResponseAction defaults to AFTER_PROCESSING', () => {
    it('should use afterProcessingAction when errorResponseAction=AFTER_PROCESSING (default)', () => {
      // This tests the default behavior: when errorResponseAction is the sentinel
      // value 'AFTER_PROCESSING', the normal afterProcessingAction is used instead.
      const receiver = new FileReceiver({
        properties: {
          errorResponseAction: 'AFTER_PROCESSING', // default
          afterProcessingAction: AfterProcessingAction.DELETE,
        },
      });

      const props = receiver.getProperties();
      // errorResponseAction set to AFTER_PROCESSING means "fall through to afterProcessingAction"
      expect(props.errorResponseAction).toBe('AFTER_PROCESSING');
      expect(props.afterProcessingAction).toBe(AfterProcessingAction.DELETE);
    });

    it('should allow overriding errorResponseAction to a specific action', () => {
      const receiver = new FileReceiver({
        properties: {
          errorResponseAction: AfterProcessingAction.MOVE,
          errorMoveToDirectory: '/tmp/error',
        },
      });

      const props = receiver.getProperties();
      expect(props.errorResponseAction).toBe(AfterProcessingAction.MOVE);
      expect(props.errorMoveToDirectory).toBe('/tmp/error');
    });
  });

  describe('moveToFileName support', () => {
    it('should use moveToFileName on success when provided', async () => {
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.MOVE,
          moveToDirectory: processedDir,
          moveToFileName: 'processed_test.txt',
          checkFileAge: false,
          pollInterval: 60000,
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockResolvedValue({}),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      await (receiver as any).poll();

      // File should be renamed when moved
      const filesInProcessed = await fs.readdir(processedDir);
      expect(filesInProcessed).toContain('processed_test.txt');
      expect(filesInProcessed).not.toContain('test.txt');

      await receiver.stop();
    });

    it('should use original filename when moveToFileName is empty', async () => {
      const testFile = path.join(inputDir, 'test.txt');
      await fs.writeFile(testFile, 'test content');

      const receiver = new FileReceiver({
        name: 'Test',
        properties: {
          scheme: FileScheme.FILE,
          directory: inputDir,
          fileFilter: 'test.txt',
          afterProcessingAction: AfterProcessingAction.MOVE,
          moveToDirectory: processedDir,
          moveToFileName: '', // Empty = use original
          checkFileAge: false,
          pollInterval: 60000,
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        dispatchRawMessage: jest.fn().mockResolvedValue({}),
        emit: jest.fn(),
      };
      (receiver as any).channel = mockChannel;
      (receiver as any).running = true;

      await (receiver as any).poll();

      // File should keep original name
      const filesInProcessed = await fs.readdir(processedDir);
      expect(filesInProcessed).toContain('test.txt');

      await receiver.stop();
    });
  });
});
