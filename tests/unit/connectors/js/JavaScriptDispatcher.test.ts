import { JavaScriptDispatcher } from '../../../../src/connectors/js/JavaScriptDispatcher';
import { getDefaultJavaScriptDispatcherProperties, JAVASCRIPT_DISPATCHER_NAME } from '../../../../src/connectors/js/JavaScriptDispatcherProperties';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Mock the DashboardStatusController to capture events
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: jest.fn(),
  },
}));

// Mock AlertSender — keep real module, only override getAlertEventController
const mockDispatchEvent = jest.fn();
jest.mock('../../../../src/javascript/userutil/AlertSender', () => {
  const actual = jest.requireActual('../../../../src/javascript/userutil/AlertSender');
  return {
    ...actual,
    getAlertEventController: () => ({
      dispatchEvent: mockDispatchEvent,
    }),
  };
});

import { dashboardStatusController } from '../../../../src/plugins/dashboardstatus/DashboardStatusController';

function createConnectorMessage(options?: {
  messageId?: number;
  channelId?: string;
  rawData?: string;
  encodedData?: string;
}): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: options?.messageId ?? 1,
    metaDataId: 1,
    channelId: options?.channelId ?? 'ch-1',
    channelName: 'Test Channel',
    connectorName: 'JavaScript Writer',
    serverId: 'node-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (options?.rawData) {
    msg.setContent({
      contentType: ContentType.RAW,
      content: options.rawData,
      dataType: 'RAW',
      encrypted: false,
    });
  }

  if (options?.encodedData) {
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: options.encodedData,
      dataType: 'HL7V2',
      encrypted: false,
    });
  }

  return msg;
}

describe('JavaScriptDispatcherProperties', () => {
  it('should have correct defaults', () => {
    const defaults = getDefaultJavaScriptDispatcherProperties();
    expect(defaults.script).toBe('');
  });

  it('should have correct connector name constant', () => {
    expect(JAVASCRIPT_DISPATCHER_NAME).toBe('JavaScript Writer');
  });
});

describe('JavaScriptDispatcher', () => {
  let dispatcher: JavaScriptDispatcher;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default properties', () => {
      dispatcher = new JavaScriptDispatcher({ metaDataId: 1 });
      const props = dispatcher.getProperties();
      expect(props.script).toBe('');
    });

    it('should accept custom properties', () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        name: 'My JS Writer',
        properties: {
          script: 'return new Response(SENT, "OK");',
        },
      });
      expect(dispatcher.getName()).toBe('My JS Writer');
      expect(dispatcher.getProperties().script).toBe('return new Response(SENT, "OK");');
    });

    it('should default name to "JavaScript Writer"', () => {
      dispatcher = new JavaScriptDispatcher({ metaDataId: 1 });
      expect(dispatcher.getName()).toBe('JavaScript Writer');
    });

    it('should set transport name to "JavaScript Writer"', () => {
      dispatcher = new JavaScriptDispatcher({ metaDataId: 1 });
      expect(dispatcher.getTransportName()).toBe('JavaScript Writer');
    });

    it('should use provided metaDataId', () => {
      dispatcher = new JavaScriptDispatcher({ metaDataId: 3 });
      expect(dispatcher.getMetaDataId()).toBe(3);
    });
  });

  describe('onDeploy', () => {
    it('should compile the script at deploy time', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'return "deployed";' },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      dispatcher.setChannel(mockChannel as any);

      await dispatcher.onDeploy();
      // No error means script compiled successfully
    });

    it('should dispatch IDLE event after deploy', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'return "test";' },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      dispatcher.setChannel(mockChannel as any);

      await dispatcher.onDeploy();

      expect(dashboardStatusController.processEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'ch-1',
          metadataId: 1,
          state: 'IDLE',
        })
      );
    });

    it('should throw on script compilation error', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'function(' }, // Invalid syntax
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      dispatcher.setChannel(mockChannel as any);

      await expect(dispatcher.onDeploy()).rejects.toThrow();
    });

    it('should transpile E4X in the script', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'var x = <test/>; return x.toString();' },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      dispatcher.setChannel(mockChannel as any);

      // Should not throw — E4X gets transpiled
      await dispatcher.onDeploy();
    });
  });

  describe('onUndeploy', () => {
    it('should clear compiled script', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'return "test";' },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      dispatcher.setChannel(mockChannel as any);
      await dispatcher.onDeploy();

      await dispatcher.onUndeploy();
      // Internal state cleared
    });
  });

  describe('replaceConnectorProperties', () => {
    it('should be a no-op (matches Java)', () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'return "${variable}";' },
      });
      const msg = createConnectorMessage();

      // replaceConnectorProperties should return properties unchanged
      const original = dispatcher.getProperties();
      const replaced = dispatcher.replaceConnectorProperties(original, msg);
      expect(replaced).toEqual(original);
    });
  });

  describe('send', () => {
    let mockChannel: any;

    beforeEach(() => {
      mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
    });

    it('should return SENT status on successful string return', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'return "response data";' },
      });
      dispatcher.setChannel(mockChannel);
      await dispatcher.onDeploy();

      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      const responseContent = msg.getResponseContent();
      expect(responseContent?.content).toBe('response data');
    });

    it('should return SENT status with default message on null return', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'var x = 1;' },
      });
      dispatcher.setChannel(mockChannel);
      await dispatcher.onDeploy();

      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
    });

    it('should return ERROR status on script error', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'throw new Error("dispatch failed");' },
      });
      dispatcher.setChannel(mockChannel);
      await dispatcher.onDeploy();

      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
    });

    it('should handle Response object return from script', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: {
          script: 'return new Response(SENT, "custom response");',
        },
      });
      dispatcher.setChannel(mockChannel);
      await dispatcher.onDeploy();

      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
    });

    it('should handle Status enum return from script', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: {
          script: 'return QUEUED;',
        },
      });
      dispatcher.setChannel(mockChannel);
      await dispatcher.onDeploy();

      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.QUEUED);
    });

    it('should dispatch SENDING and IDLE events', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'return "ok";' },
      });
      dispatcher.setChannel(mockChannel);
      await dispatcher.onDeploy();
      jest.clearAllMocks(); // Clear deploy events

      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      const calls = (dashboardStatusController.processEvent as any).mock.calls;
      const states = calls.map((c: any) => c[0].state);
      expect(states).toContain('SENDING');
      expect(states).toContain('IDLE');
      // SENDING should come before IDLE
      expect(states.indexOf('SENDING')).toBeLessThan(states.indexOf('IDLE'));
    });

    it('should dispatch IDLE even on error', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'throw new Error("boom");' },
      });
      dispatcher.setChannel(mockChannel);
      await dispatcher.onDeploy();
      jest.clearAllMocks();

      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      const calls = (dashboardStatusController.processEvent as any).mock.calls;
      const states = calls.map((c: any) => c[0].state);
      expect(states).toContain('IDLE');
    });

    it('should make connector message available in script scope', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: {
          // Access connectorMessage properties from the scope
          script: 'return connectorMessage.getRawData() || "no-data";',
        },
      });
      dispatcher.setChannel(mockChannel);
      await dispatcher.onDeploy();

      const msg = createConnectorMessage({ rawData: 'test-raw-data' });
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      const responseContent = msg.getResponseContent();
      expect(responseContent?.content).toBe('test-raw-data');
    });
  });

  describe('getResponse', () => {
    it('should return response content from connector message', async () => {
      dispatcher = new JavaScriptDispatcher({ metaDataId: 1 });
      const msg = createConnectorMessage();
      msg.setContent({
        contentType: ContentType.RESPONSE,
        content: 'response-data',
        dataType: 'RAW',
        encrypted: false,
      });

      const response = await dispatcher.getResponse(msg);
      expect(response).toBe('response-data');
    });

    it('should return null when no response content', async () => {
      dispatcher = new JavaScriptDispatcher({ metaDataId: 1 });
      const msg = createConnectorMessage();

      const response = await dispatcher.getResponse(msg);
      expect(response).toBeNull();
    });
  });

  describe('ErrorEvent dispatch on script error (CPC-W20-002)', () => {
    it('should dispatch ErrorEvent when script throws', async () => {
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: { script: 'throw new Error("dispatch failed");' },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      dispatcher.setChannel(mockChannel as any);
      await dispatcher.onDeploy();

      mockDispatchEvent.mockClear();
      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'ch-1',
          metaDataId: 1,
          eventType: 'DESTINATION_CONNECTOR',
          connectorName: 'JavaScript Writer',
        })
      );
      expect(mockDispatchEvent.mock.calls[0][0].errorMessage).toContain('dispatch failed');
    });
  });

  describe('duck-typed Response detection (CPC-W20-009)', () => {
    it('should detect Response-like objects via duck typing', async () => {
      // Simulate what happens when Response is created inside a VM sandbox:
      // it has getStatus/getMessage methods but is NOT instanceof Response
      dispatcher = new JavaScriptDispatcher({
        metaDataId: 1,
        properties: {
          // Use the scope's Response class (available in VM) — returns a Response-like object
          script: 'return new Response(SENT, "duck-typed response");',
        },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      dispatcher.setChannel(mockChannel as any);
      await dispatcher.onDeploy();

      const msg = createConnectorMessage({ rawData: 'input' });
      await dispatcher.send(msg);

      // The Response from the VM sandbox should be detected via duck-typing
      expect(msg.getStatus()).toBe(Status.SENT);
    });
  });
});
