/**
 * DatabaseDispatcher Event Dispatch Parity Tests (Wave 17)
 *
 * Verifies that DatabaseDispatcher dispatches connection status events
 * matching Java DatabaseDispatcher.java lifecycle:
 *   - start(): IDLE
 *   - send(): READING (with URL info) -> execute -> IDLE (in finally)
 */

import { DatabaseDispatcher } from '../../../../src/connectors/jdbc/DatabaseDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ConnectionStatusEventType } from '../../../../src/plugins/dashboardstatus/ConnectionLogItem';

// Mock the DashboardStatusController to capture events
const mockProcessEvent = jest.fn();
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: (...args: unknown[]) => mockProcessEvent(...args),
  },
}));

// Mock mysql2/promise
const mockExecute = jest.fn().mockResolvedValue([{ affectedRows: 1, insertId: 1, warningStatus: 0 }]);
const mockRelease = jest.fn();
const mockGetConnection = jest.fn().mockResolvedValue({
  execute: mockExecute,
  release: mockRelease,
});
jest.mock('mysql2/promise', () => ({
  createPool: jest.fn().mockReturnValue({
    getConnection: () => mockGetConnection(),
    end: jest.fn().mockResolvedValue(undefined),
  }),
}));

function createTestConnectorMessage(): ConnectorMessage {
  return new ConnectorMessage({
    channelId: 'test-channel-id',
    messageId: 1,
    metaDataId: 1,
    channelName: 'Test Channel',
    connectorName: 'Database Writer',
    serverId: 'test-server',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
}

describe('DatabaseDispatcher Event Dispatch Parity', () => {
  let dispatcher: DatabaseDispatcher;

  beforeEach(() => {
    mockProcessEvent.mockClear();
    mockExecute.mockClear();
    mockRelease.mockClear();
    mockGetConnection.mockClear();
    mockGetConnection.mockResolvedValue({
      execute: mockExecute,
      release: mockRelease,
    });
  });

  afterEach(async () => {
    if (dispatcher?.isRunning()) {
      await dispatcher.stop();
    }
  });

  it('should dispatch IDLE on start (matching Java onDeploy)', async () => {
    dispatcher = new DatabaseDispatcher({
      metaDataId: 1,
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        query: 'INSERT INTO t VALUES (?)',
      },
    });

    (dispatcher as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await dispatcher.start();

    expect(mockProcessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        state: ConnectionStatusEventType.IDLE,
        channelId: 'test-channel-id',
        metadataId: 1,
      })
    );
  });

  it('should dispatch READING before query execution in send()', async () => {
    dispatcher = new DatabaseDispatcher({
      metaDataId: 1,
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        query: 'INSERT INTO t VALUES (?)',
      },
    });

    (dispatcher as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await dispatcher.start();
    mockProcessEvent.mockClear();

    const msg = createTestConnectorMessage();
    await dispatcher.send(msg);

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events[0]).toBe(ConnectionStatusEventType.READING);
  });

  it('should include URL info in READING event message', async () => {
    dispatcher = new DatabaseDispatcher({
      metaDataId: 1,
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        query: 'INSERT INTO t VALUES (?)',
      },
    });

    (dispatcher as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await dispatcher.start();
    mockProcessEvent.mockClear();

    const msg = createTestConnectorMessage();
    await dispatcher.send(msg);

    const readingCall = mockProcessEvent.mock.calls.find((c: any) => c[0].state === ConnectionStatusEventType.READING);
    expect(readingCall).toBeDefined();
    expect(readingCall![0].message).toContain('URL:');
  });

  it('should dispatch IDLE in finally after send completes', async () => {
    dispatcher = new DatabaseDispatcher({
      metaDataId: 1,
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        query: 'INSERT INTO t VALUES (?)',
      },
    });

    (dispatcher as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await dispatcher.start();
    mockProcessEvent.mockClear();

    const msg = createTestConnectorMessage();
    await dispatcher.send(msg);

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events[events.length - 1]).toBe(ConnectionStatusEventType.IDLE);
  });

  it('should dispatch IDLE even on send error (finally block)', async () => {
    dispatcher = new DatabaseDispatcher({
      metaDataId: 1,
      queueEnabled: true,
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        query: 'INSERT INTO t VALUES (?)',
      },
    });

    (dispatcher as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await dispatcher.start();
    mockProcessEvent.mockClear();

    mockExecute.mockRejectedValueOnce(new Error('SQL error'));

    const msg = createTestConnectorMessage();
    await dispatcher.send(msg);

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events[events.length - 1]).toBe(ConnectionStatusEventType.IDLE);
  });

  it('should follow READING -> IDLE lifecycle in send()', async () => {
    dispatcher = new DatabaseDispatcher({
      metaDataId: 1,
      properties: {
        url: 'jdbc:mysql://localhost:3306/testdb',
        query: 'INSERT INTO t VALUES (?)',
      },
    });

    (dispatcher as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await dispatcher.start();
    mockProcessEvent.mockClear();

    const msg = createTestConnectorMessage();
    await dispatcher.send(msg);

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toEqual([ConnectionStatusEventType.READING, ConnectionStatusEventType.IDLE]);
  });
});
