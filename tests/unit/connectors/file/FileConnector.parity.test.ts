/**
 * File Connector Parity Tests (Wave 17)
 *
 * Validates that File connector defaults and behavior match Java Mirth:
 * - CPC-MCP-004/005: secure default = true (FTPS)
 * - CPC-MCP-006: anonymous/username/password defaults
 * - CPC-MCE-002: FileDispatcher event dispatch (WRITING/IDLE)
 */

// Mock modules with missing dependencies in worktree
jest.mock('mysql2/promise', () => ({}));
jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(true),
  }));
});

// Mock the dashboard status controller to capture events
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: jest.fn(),
  },
}));

import {
  getDefaultFileReceiverProperties,
  getDefaultFileDispatcherProperties,
} from '../../../../src/connectors/file/FileConnectorProperties';
import { FileDispatcher } from '../../../../src/connectors/file/FileDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ConnectionStatusEventType } from '../../../../src/plugins/dashboardstatus/ConnectionLogItem';
import { dashboardStatusController } from '../../../../src/plugins/dashboardstatus/DashboardStatusController';

describe('File Connector Parity (Wave 17)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CPC-MCP-004/005: secure default matches Java (FTPS)', () => {
    it('FileReceiverProperties secure defaults to true', () => {
      const props = getDefaultFileReceiverProperties();
      // Java: FileReceiverProperties.secure defaults to true
      // This ensures FTP connections default to FTPS (encrypted)
      expect(props.secure).toBe(true);
    });

    it('FileDispatcherProperties secure defaults to true', () => {
      const props = getDefaultFileDispatcherProperties();
      // Java: FileDispatcherProperties.secure defaults to true
      expect(props.secure).toBe(true);
    });
  });

  describe('CPC-MCP-006: anonymous/username/password defaults match Java', () => {
    it('FileReceiverProperties anonymous defaults to true', () => {
      const props = getDefaultFileReceiverProperties();
      // Java: FileReceiverProperties.anonymous defaults to true
      expect(props.anonymous).toBe(true);
    });

    it('FileReceiverProperties username defaults to "anonymous"', () => {
      const props = getDefaultFileReceiverProperties();
      // Java: FileReceiverProperties.username defaults to "anonymous"
      expect(props.username).toBe('anonymous');
    });

    it('FileReceiverProperties password defaults to "anonymous"', () => {
      const props = getDefaultFileReceiverProperties();
      // Java: FileReceiverProperties.password defaults to "anonymous"
      expect(props.password).toBe('anonymous');
    });

    it('FileDispatcherProperties anonymous defaults to true', () => {
      const props = getDefaultFileDispatcherProperties();
      expect(props.anonymous).toBe(true);
    });

    it('FileDispatcherProperties username defaults to "anonymous"', () => {
      const props = getDefaultFileDispatcherProperties();
      expect(props.username).toBe('anonymous');
    });

    it('FileDispatcherProperties password defaults to "anonymous"', () => {
      const props = getDefaultFileDispatcherProperties();
      expect(props.password).toBe('anonymous');
    });
  });

  describe('CPC-MCE-002: FileDispatcher dispatches WRITING/IDLE events', () => {
    let dispatcher: FileDispatcher;
    const mockProcessEvent = dashboardStatusController.processEvent as jest.Mock;

    beforeEach(async () => {
      // Create a dispatcher with a real temp directory for local file writes
      const os = await import('os');
      const fs = await import('fs/promises');
      const tmpDir = await fs.mkdtemp(`${os.tmpdir()}/mirth-file-parity-`);

      dispatcher = new FileDispatcher({
        name: 'Test File Dispatcher',
        metaDataId: 1,
        properties: {
          directory: tmpDir,
          outputPattern: 'test_output.txt',
          outputAppend: false,
        },
      });

      // We need to set a channel on the dispatcher for events to fire.
      // dispatchConnectionEvent checks this.channel and returns early if null.
      (dispatcher as any).channel = {
        getId: () => 'test-channel-id',
        getName: () => 'Test Channel',
      };

      await dispatcher.start();
      mockProcessEvent.mockClear(); // Clear the IDLE event from start()
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('dispatches WRITING event before file write', async () => {
      const msg = new ConnectorMessage({
        channelId: 'test-channel-id',
        messageId: 1,
        metaDataId: 1,
        channelName: 'Test Channel',
        connectorName: 'File Writer',
        serverId: 'test-server',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      msg.setRawData('test content');

      await dispatcher.send(msg);

      // First event should be WRITING
      const calls = mockProcessEvent.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[0][0].state).toBe(ConnectionStatusEventType.WRITING);
    });

    it('dispatches IDLE event after file write (in finally)', async () => {
      const msg = new ConnectorMessage({
        channelId: 'test-channel-id',
        messageId: 1,
        metaDataId: 1,
        channelName: 'Test Channel',
        connectorName: 'File Writer',
        serverId: 'test-server',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      msg.setRawData('test content');

      await dispatcher.send(msg);

      // Last event should be IDLE (from finally block)
      const calls = mockProcessEvent.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[calls.length - 1][0].state).toBe(ConnectionStatusEventType.IDLE);
    });
  });
});
