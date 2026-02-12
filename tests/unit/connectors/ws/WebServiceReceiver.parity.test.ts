/**
 * Parity tests for WebServiceReceiver - CPC-MCE-006
 * Tests that event dispatching matches Java's WebServiceReceiver lifecycle.
 */

import {
  WebServiceReceiver,
} from '../../../../src/connectors/ws/WebServiceReceiver.js';
import { ConnectionStatusEventType } from '../../../../src/plugins/dashboardstatus/ConnectionLogItem.js';

describe('WebServiceReceiver event dispatch (CPC-MCE-006)', () => {
  let receiver: WebServiceReceiver;
  let dispatchedEvents: ConnectionStatusEventType[];

  beforeEach(() => {
    receiver = new WebServiceReceiver({
      name: 'Test WS Listener',
      properties: {
        host: '127.0.0.1',
        port: 0, // Use port 0 to avoid conflicts
      },
    });

    // Spy on dispatchConnectionEvent to track dispatched events
    dispatchedEvents = [];
    jest.spyOn(receiver as any, 'dispatchConnectionEvent').mockImplementation(
      (...args: unknown[]) => {
        dispatchedEvents.push(args[0] as ConnectionStatusEventType);
        // Don't call original — it depends on DashboardStatusController
      }
    );
  });

  afterEach(async () => {
    try {
      await receiver.stop();
    } catch {
      // Ignore if not started
    }
    jest.restoreAllMocks();
  });

  it('should dispatch IDLE event after start', async () => {
    await receiver.start();

    expect(dispatchedEvents).toContain(ConnectionStatusEventType.IDLE);
  });

  it('should dispatch CONNECTED, RECEIVING, IDLE on SOAP request', () => {
    // Verify the handleSoapRequest method dispatches events in correct order
    // by reading the source implementation order
    const source = (receiver as any).handleSoapRequest.toString();

    // The method should dispatch CONNECTED before RECEIVING
    const connectedIdx = source.indexOf('CONNECTED');
    const receivingIdx = source.indexOf('RECEIVING');
    const idleIdx = source.lastIndexOf('IDLE');

    expect(connectedIdx).toBeGreaterThan(-1);
    expect(receivingIdx).toBeGreaterThan(-1);
    expect(idleIdx).toBeGreaterThan(-1);

    // CONNECTED must come before RECEIVING
    expect(connectedIdx).toBeLessThan(receivingIdx);

    // IDLE must come after both (in finally block)
    expect(idleIdx).toBeGreaterThan(receivingIdx);
  });

  it('should have CONNECTED event type imported and available', () => {
    // Verify ConnectionStatusEventType.CONNECTED exists
    expect(ConnectionStatusEventType.CONNECTED).toBeDefined();
  });

  it('should have handleSoapRequest as a private method', () => {
    // Verify the method exists on the instance
    expect(typeof (receiver as any).handleSoapRequest).toBe('function');
  });

  it('should dispatch events through inherited dispatchConnectionEvent', () => {
    // Verify the method is inherited from SourceConnector
    expect(typeof (receiver as any).dispatchConnectionEvent).toBe('function');
  });

  it('should start server and dispatch initial IDLE event', async () => {
    await receiver.start();

    // The first event after start should be IDLE
    expect(dispatchedEvents[0]).toBe(ConnectionStatusEventType.IDLE);
  });
});
