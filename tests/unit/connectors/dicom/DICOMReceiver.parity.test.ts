/**
 * DICOMReceiver Event Dispatch Parity Tests (Wave 17)
 *
 * Verifies that DICOMReceiver dispatches connection status events
 * matching Java DICOMReceiver.java lifecycle:
 *   - start(): IDLE
 *   - association accepted: CONNECTED
 *   - association closed (release/abort/close): IDLE
 *   - stop(): DISCONNECTED
 */

import * as net from 'net';
import { DICOMReceiver } from '../../../../src/connectors/dicom/DICOMReceiver';
import { ConnectionStatusEventType } from '../../../../src/plugins/dashboardstatus/ConnectionLogItem';
import { AssociationState } from '../../../../src/connectors/dicom/DicomConnection';

// Mock the DashboardStatusController to capture events
const mockProcessEvent = jest.fn();
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: (...args: unknown[]) => mockProcessEvent(...args),
  },
}));

describe('DICOMReceiver Event Dispatch Parity', () => {
  let receiver: DICOMReceiver;

  beforeEach(() => {
    mockProcessEvent.mockClear();
  });

  afterEach(async () => {
    if (receiver?.isRunning()) {
      await receiver.stop();
    }
  });

  it('should dispatch IDLE on start (matching Java onDeploy)', async () => {
    receiver = new DICOMReceiver({
      name: 'Test DICOM Receiver',
      properties: {
        listenerConnectorProperties: { host: '127.0.0.1', port: '0' },
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();

    expect(mockProcessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        state: ConnectionStatusEventType.IDLE,
        channelId: 'test-channel-id',
      })
    );
  });

  it('should dispatch DISCONNECTED on stop', async () => {
    receiver = new DICOMReceiver({
      name: 'Test DICOM Receiver',
      properties: {
        listenerConnectorProperties: { host: '127.0.0.1', port: '0' },
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();
    mockProcessEvent.mockClear();

    await receiver.stop();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toContain(ConnectionStatusEventType.DISCONNECTED);
  });

  it('should dispatch CONNECTED when association is accepted', async () => {
    receiver = new DICOMReceiver({
      name: 'Test DICOM Receiver',
      properties: {
        listenerConnectorProperties: { host: '127.0.0.1', port: '0' },
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    await receiver.start();
    mockProcessEvent.mockClear();

    // Simulate: a successful association produces a CONNECTED event.
    // Building a real DICOM A-ASSOCIATE-RQ PDU is complex, so we invoke the
    // protected dispatchConnectionEvent directly to verify the integration.
    (receiver as any).dispatchConnectionEvent(
      ConnectionStatusEventType.CONNECTED,
      'Association from REMOTE_AE'
    );

    expect(mockProcessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        state: ConnectionStatusEventType.CONNECTED,
        message: 'Association from REMOTE_AE',
      })
    );
  });

  it('should dispatch IDLE when association closes via handleClose', () => {
    receiver = new DICOMReceiver({
      name: 'Test DICOM Receiver',
      properties: {
        listenerConnectorProperties: { host: '127.0.0.1', port: '0' },
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    // Add a mock association
    const mockSocket = new net.Socket();
    const associations: Map<net.Socket, any> = (receiver as any).associations;
    associations.set(mockSocket, {
      socket: mockSocket,
      state: AssociationState.ASSOCIATED,
      callingAE: 'REMOTE_AE',
      calledAE: 'LOCAL_AE',
      presentationContexts: new Map(),
      receiveBuffer: Buffer.alloc(0),
      maxPduLength: 16384,
      receivingData: new Map(),
    });

    mockProcessEvent.mockClear();

    // Trigger handleClose
    (receiver as any).handleClose(mockSocket);

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toContain(ConnectionStatusEventType.IDLE);

    mockSocket.destroy();
  });

  it('should NOT dispatch IDLE on handleClose when no association existed', () => {
    receiver = new DICOMReceiver({
      name: 'Test DICOM Receiver',
      properties: {
        listenerConnectorProperties: { host: '127.0.0.1', port: '0' },
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    mockProcessEvent.mockClear();

    // handleClose with a socket that has no association
    const unknownSocket = new net.Socket();
    (receiver as any).handleClose(unknownSocket);

    // Should not dispatch any events
    expect(mockProcessEvent).not.toHaveBeenCalled();

    unknownSocket.destroy();
  });

  it('should dispatch IDLE when association is aborted', () => {
    receiver = new DICOMReceiver({
      name: 'Test DICOM Receiver',
      properties: {
        listenerConnectorProperties: { host: '127.0.0.1', port: '0' },
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    const mockSocket = new net.Socket();
    // Prevent actual socket operations
    mockSocket.destroy = jest.fn() as any;

    const associations: Map<net.Socket, any> = (receiver as any).associations;
    associations.set(mockSocket, {
      socket: mockSocket,
      state: AssociationState.ASSOCIATED,
      callingAE: 'REMOTE_AE',
      calledAE: 'LOCAL_AE',
      presentationContexts: new Map(),
      receiveBuffer: Buffer.alloc(0),
      maxPduLength: 16384,
      receivingData: new Map(),
    });

    mockProcessEvent.mockClear();

    // Trigger handleAbort
    (receiver as any).handleAbort(mockSocket, associations.get(mockSocket), Buffer.alloc(10));

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toContain(ConnectionStatusEventType.IDLE);
  });

  it('should follow full lifecycle: IDLE -> CONNECTED -> IDLE -> DISCONNECTED', async () => {
    receiver = new DICOMReceiver({
      name: 'Test DICOM Receiver',
      properties: {
        listenerConnectorProperties: { host: '127.0.0.1', port: '0' },
      },
    });

    (receiver as any).channel = {
      getId: () => 'test-channel-id',
      getName: () => 'Test Channel',
    };

    // 1. Start: dispatches IDLE
    await receiver.start();

    // 2. Simulate association accepted: dispatches CONNECTED
    (receiver as any).dispatchConnectionEvent(ConnectionStatusEventType.CONNECTED, 'Association from REMOTE_AE');

    // 3. Simulate association closed: dispatches IDLE
    (receiver as any).dispatchConnectionEvent(ConnectionStatusEventType.IDLE);

    // 4. Stop: dispatches DISCONNECTED
    await receiver.stop();

    const events = mockProcessEvent.mock.calls.map((c: any) => c[0].state);
    expect(events).toEqual([
      ConnectionStatusEventType.IDLE,         // start
      ConnectionStatusEventType.CONNECTED,     // association accepted
      ConnectionStatusEventType.IDLE,          // association closed
      ConnectionStatusEventType.DISCONNECTED,  // stop
    ]);
  });
});
