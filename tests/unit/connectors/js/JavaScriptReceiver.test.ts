import { JavaScriptReceiver } from '../../../../src/connectors/js/JavaScriptReceiver';
import { getDefaultJavaScriptReceiverProperties, JAVASCRIPT_RECEIVER_NAME } from '../../../../src/connectors/js/JavaScriptReceiverProperties';
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

describe('JavaScriptReceiverProperties', () => {
  it('should have correct defaults', () => {
    const defaults = getDefaultJavaScriptReceiverProperties();
    expect(defaults.script).toBe('');
    expect(defaults.pollInterval).toBe(5000);
    expect(defaults.processBatch).toBe(false);
  });

  it('should have correct connector name constant', () => {
    expect(JAVASCRIPT_RECEIVER_NAME).toBe('JavaScript Reader');
  });
});

describe('JavaScriptReceiver', () => {
  let receiver: JavaScriptReceiver;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaultExecutor();
  });

  afterEach(async () => {
    if (receiver?.isRunning()) {
      await receiver.stop();
    }
  });

  describe('constructor', () => {
    it('should create with default properties', () => {
      receiver = new JavaScriptReceiver({});
      const props = receiver.getProperties();
      expect(props.script).toBe('');
      expect(props.pollInterval).toBe(5000);
      expect(props.processBatch).toBe(false);
    });

    it('should accept custom properties', () => {
      receiver = new JavaScriptReceiver({
        name: 'My JS Reader',
        properties: {
          script: 'return "hello";',
          pollInterval: 10000,
        },
      });
      const props = receiver.getProperties();
      expect(props.script).toBe('return "hello";');
      expect(props.pollInterval).toBe(10000);
      expect(receiver.getName()).toBe('My JS Reader');
    });

    it('should default name to "JavaScript Reader"', () => {
      receiver = new JavaScriptReceiver({});
      expect(receiver.getName()).toBe('JavaScript Reader');
    });

    it('should set transport name to "JavaScript Reader"', () => {
      receiver = new JavaScriptReceiver({});
      expect(receiver.getTransportName()).toBe('JavaScript Reader');
    });
  });

  describe('onDeploy', () => {
    it('should transpile E4X in the script', async () => {
      receiver = new JavaScriptReceiver({
        properties: {
          script: 'var msg = <test/>; return msg.toString();',
        },
      });

      // Mock channel for event dispatch
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);

      await receiver.onDeploy();

      // Script should be compiled (transpiled) without error
      // Verified by the fact that onDeploy didn't throw
    });

    it('should dispatch IDLE event after deploy', async () => {
      receiver = new JavaScriptReceiver({
        properties: { script: 'return "test";' },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);

      await receiver.onDeploy();

      expect(dashboardStatusController.processEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'ch-1',
          state: 'IDLE',
        })
      );
    });

    it('should throw on script compilation error', async () => {
      receiver = new JavaScriptReceiver({
        properties: { script: 'function(' }, // Invalid syntax
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);

      await expect(receiver.onDeploy()).rejects.toThrow();
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start and stop without error', async () => {
      receiver = new JavaScriptReceiver({
        properties: { script: 'return "test";', pollInterval: 60000 },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      await receiver.start();
      expect(receiver.isRunning()).toBe(true);

      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });

    it('should throw if started twice', async () => {
      receiver = new JavaScriptReceiver({
        properties: { script: 'return "test";', pollInterval: 60000 },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      await receiver.start();
      await expect(receiver.start()).rejects.toThrow('already running');
    });

    it('should be safe to stop when not running', async () => {
      receiver = new JavaScriptReceiver({
        properties: { script: 'return "test";' },
      });
      // Should not throw
      await receiver.stop();
    });
  });

  describe('onUndeploy', () => {
    it('should clear compiled script', async () => {
      receiver = new JavaScriptReceiver({
        properties: { script: 'return "test";' },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);

      await receiver.onDeploy();
      await receiver.onUndeploy();

      // Internal state cleared — can verify by deploying again
      // (no error means clean state)
    });
  });

  describe('convertJavaScriptResult', () => {
    // We need to test the conversion logic through the public poll mechanism,
    // but since poll() is private, we test via the public interface by
    // exposing convertJavaScriptResult or testing end-to-end through poll().
    // Since the Java implementation's result conversion is critical,
    // we test it through the receiver's static helper.

    it('should handle null result (no messages)', () => {
      receiver = new JavaScriptReceiver({});
      // Access internal method for testing
      const messages = (receiver as any).convertJavaScriptResult(null);
      expect(messages).toEqual([]);
    });

    it('should handle undefined result (no messages)', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult(undefined);
      expect(messages).toEqual([]);
    });

    it('should handle string result (single message)', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult('MSH|^~\\&|');
      expect(messages).toEqual(['MSH|^~\\&|']);
    });

    it('should handle empty string result (no messages)', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult('');
      expect(messages).toEqual([]);
    });

    it('should handle array of strings (multiple messages)', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult([
        'message1',
        'message2',
        'message3',
      ]);
      expect(messages).toHaveLength(3);
      expect(messages[0]).toBe('message1');
      expect(messages[1]).toBe('message2');
      expect(messages[2]).toBe('message3');
    });

    it('should skip null elements in array', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult([
        'message1',
        null,
        'message3',
      ]);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBe('message1');
      expect(messages[1]).toBe('message3');
    });

    it('should skip empty string elements in array', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult([
        'message1',
        '',
        'message3',
      ]);
      expect(messages).toHaveLength(2);
    });

    it('should handle RawMessage-like objects in array', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult([
        { rawData: 'raw-message-1', sourceMap: new Map() },
        'plain-string',
      ]);
      expect(messages).toHaveLength(2);
      expect(messages[0].rawData).toBe('raw-message-1');
      expect(messages[1]).toBe('plain-string');
    });

    it('should handle single RawMessage-like object', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult({
        rawData: 'raw-message',
        sourceMap: new Map([['key', 'value']]),
      });
      expect(messages).toHaveLength(1);
      expect(messages[0].rawData).toBe('raw-message');
    });

    it('should handle number result (converts to string)', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult(42);
      expect(messages).toEqual(['42']);
    });

    it('should handle empty array (no messages)', () => {
      receiver = new JavaScriptReceiver({});
      const messages = (receiver as any).convertJavaScriptResult([]);
      expect(messages).toEqual([]);
    });
  });

  describe('poll event dispatching', () => {
    it('should dispatch READING then IDLE during poll', async () => {
      receiver = new JavaScriptReceiver({
        properties: {
          script: 'return "test-message";',
          pollInterval: 60000, // Long interval to prevent auto-poll
        },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn().mockResolvedValue(undefined),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      // Clear deploy events so we only see poll events
      jest.clearAllMocks();

      // Must be running for poll to execute
      (receiver as any).running = true;

      // Manually trigger poll
      await (receiver as any).poll();

      const calls = (dashboardStatusController.processEvent as any).mock.calls;
      const states = calls.map((c: any) => c[0].state);
      // Should include READING (during poll) and IDLE (after poll)
      expect(states).toContain('READING');
      expect(states).toContain('IDLE');
    });
  });

  describe('poll error handling', () => {
    it('should not crash on script execution error', async () => {
      receiver = new JavaScriptReceiver({
        properties: {
          script: 'throw new Error("intentional error");',
          pollInterval: 60000,
        },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      // Should not throw — errors are caught internally
      await (receiver as any).poll();
    });

    it('should not poll when not running', async () => {
      receiver = new JavaScriptReceiver({
        properties: { script: 'return "test";' },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      // Not started — poll should be a no-op
      await (receiver as any).poll();
      expect(mockChannel.dispatchRawMessage).not.toHaveBeenCalled();
    });
  });

  describe('poll dispatches raw messages', () => {
    it('should dispatch string result as raw message', async () => {
      receiver = new JavaScriptReceiver({
        properties: {
          script: 'return "HL7 message content";',
          pollInterval: 60000,
        },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn().mockResolvedValue(undefined),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      // Mark as running for poll to execute
      (receiver as any).running = true;
      await (receiver as any).poll();

      expect(mockChannel.dispatchRawMessage).toHaveBeenCalledWith(
        'HL7 message content',
        undefined
      );
    });

    it('should dispatch multiple messages from array result', async () => {
      receiver = new JavaScriptReceiver({
        properties: {
          script: 'return ["msg1", "msg2"];',
          pollInterval: 60000,
        },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn().mockResolvedValue(undefined),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      (receiver as any).running = true;
      await (receiver as any).poll();

      expect(mockChannel.dispatchRawMessage).toHaveBeenCalledTimes(2);
      expect(mockChannel.dispatchRawMessage).toHaveBeenCalledWith('msg1', undefined);
      expect(mockChannel.dispatchRawMessage).toHaveBeenCalledWith('msg2', undefined);
    });
  });

  describe('ErrorEvent dispatch on poll error (CPC-W20-001)', () => {
    it('should dispatch ErrorEvent when script throws', async () => {
      receiver = new JavaScriptReceiver({
        properties: {
          script: 'throw new Error("intentional error");',
          pollInterval: 60000,
        },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn(),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      // Mark as running for poll to execute
      (receiver as any).running = true;
      mockDispatchEvent.mockClear();

      await (receiver as any).poll();

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'ch-1',
          eventType: 'SOURCE_CONNECTOR',
          connectorName: 'JavaScript Reader',
        })
      );
      expect(mockDispatchEvent.mock.calls[0][0].errorMessage).toContain('intentional error');
    });
  });

  describe('running check during dispatch loop (CPC-W20-006)', () => {
    it('should stop dispatching messages when stopped mid-loop', async () => {
      receiver = new JavaScriptReceiver({
        properties: {
          script: 'return ["msg1", "msg2", "msg3"];',
          pollInterval: 60000,
        },
      });
      const mockChannel = {
        getId: () => 'ch-1',
        getName: () => 'Test Channel',
        emit: jest.fn(),
        dispatchRawMessage: jest.fn().mockImplementation(async () => {
          // Simulate stopping the receiver after the first dispatch
          (receiver as any).running = false;
        }),
      };
      receiver.setChannel(mockChannel as any);
      await receiver.onDeploy();

      (receiver as any).running = true;
      await (receiver as any).poll();

      // Should have dispatched only 1 message — stopped after first dispatch
      expect(mockChannel.dispatchRawMessage).toHaveBeenCalledTimes(1);
      expect(mockChannel.dispatchRawMessage).toHaveBeenCalledWith('msg1', undefined);
    });
  });
});
