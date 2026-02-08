/**
 * Integration tests for wireChannelToDashboard() — the glue between
 * Channel events and DashboardStatusController.
 *
 * Tests verify:
 * - Channel state changes propagate to dashboard
 * - Connector state changes propagate with correct metadataId
 * - messageComplete events trigger CONNECTED status
 * - Throttling: rapid messageComplete events are rate-limited to 1/second
 * - Undeploy cleans up dashboard state
 */

import { Channel, ChannelConfig } from '../../../src/donkey/channel/Channel';
import { ConnectionStatusEventType } from '../../../src/plugins/dashboardstatus/ConnectionLogItem';
import { DeployedState } from '../../../src/api/models/DashboardStatus';

import type { DashboardStatusController, ConnectionStatusEvent } from '../../../src/plugins/dashboardstatus/DashboardStatusController';

// We need a module-level reference that the mock factory can populate.
// jest.mock is hoisted, so we use requireActual inside the factory.
let mockController: DashboardStatusController;

jest.mock('../../../src/plugins/dashboardstatus/DashboardStatusController', () => {
  const actual = jest.requireActual('../../../src/plugins/dashboardstatus/DashboardStatusController');
  const ctrl = new actual.DashboardStatusController();
  ctrl.setServerId('test-server');
  // Store reference for tests
  mockController = ctrl;
  return {
    ...actual,
    dashboardStatusController: ctrl,
  };
});

// Mock the JavaScriptExecutor so Channel construction doesn't need a real runtime
jest.mock('../../../src/javascript/runtime/JavaScriptExecutor', () => ({
  getDefaultExecutor: () => ({
    executeDeploy: jest.fn().mockReturnValue({ success: true }),
    executeUndeploy: jest.fn().mockReturnValue({ success: true }),
    executePreprocessor: jest.fn().mockReturnValue({ success: true, result: '' }),
    executePostprocessor: jest.fn().mockReturnValue({ success: true }),
    executeFilter: jest.fn().mockReturnValue({ success: true, result: false }),
    executeTransformer: jest.fn().mockReturnValue({ success: true }),
  }),
  JavaScriptExecutor: class {},
}));

// Mock DB operations — Channel constructor doesn't need them but dispatchRawMessage does
jest.mock('../../../src/db/DonkeyDao', () => ({
  channelTablesExist: jest.fn().mockResolvedValue(false),
  getNextMessageId: jest.fn().mockResolvedValue(1),
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  storeContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateErrors: jest.fn().mockResolvedValue(undefined),
  updateMaps: jest.fn().mockResolvedValue(undefined),
  updateResponseMap: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(undefined),
  pruneMessageAttachments: jest.fn().mockResolvedValue(undefined),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('../../../src/db/pool', () => ({
  transaction: jest.fn().mockImplementation(async (fn: Function) => fn()),
}));

// Import after mocks are set up
import { wireChannelToDashboard } from '../../../src/controllers/EngineController';

function createTestChannel(id: string = 'test-channel-1', name: string = 'Test Channel'): Channel {
  const config: ChannelConfig = {
    id,
    name,
    enabled: true,
  };
  return new Channel(config);
}

describe('wireChannelToDashboard', () => {
  beforeEach(() => {
    // Reset the mock controller state between tests
    mockController.resetChannelState('test-channel-1');
    mockController.resetChannelState('test-channel-2');
    mockController.clearAllLogs();
    mockController.removeAllListeners();
  });

  describe('channel state changes', () => {
    it('should propagate STARTED state as CONNECTED to dashboard', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.STARTED);

      const states = mockController.getConnectionStatesForApi();
      expect(states['test-channel-1']).toBeDefined();
      expect(states['test-channel-1']!.length).toBeGreaterThanOrEqual(1);

      const sourceState = states['test-channel-1']!.find((s) => s.metadataId === '0');
      expect(sourceState).toBeDefined();
      expect(sourceState!.status).toBe('CONNECTED');
    });

    it('should propagate STOPPED state as DISCONNECTED to dashboard', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.STOPPED);

      const states = mockController.getConnectionStatesForApi();
      expect(states['test-channel-1']).toBeDefined();

      const sourceState = states['test-channel-1']!.find((s) => s.metadataId === '0');
      expect(sourceState).toBeDefined();
      expect(sourceState!.status).toBe('DISCONNECTED');
    });

    it('should propagate STARTING state as CONNECTING to dashboard', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.STARTING);

      const states = mockController.getConnectionStatesForApi();
      const sourceState = states['test-channel-1']!.find((s) => s.metadataId === '0');
      expect(sourceState!.status).toBe('CONNECTING');
    });

    it('should propagate PAUSED state as WAITING to dashboard', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.PAUSED);

      const states = mockController.getConnectionStatesForApi();
      const sourceState = states['test-channel-1']!.find((s) => s.metadataId === '0');
      expect(sourceState!.status).toBe('WAITING');
    });

    it('should map DEPLOYING state to CONNECTING', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.DEPLOYING);

      const states = mockController.getConnectionStatesForApi();
      const sourceState = states['test-channel-1']!.find((s) => s.metadataId === '0');
      expect(sourceState!.status).toBe('CONNECTING');
    });

    it('should map UNDEPLOYING state to DISCONNECTED', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.UNDEPLOYING);

      const states = mockController.getConnectionStatesForApi();
      const sourceState = states['test-channel-1']!.find((s) => s.metadataId === '0');
      expect(sourceState!.status).toBe('DISCONNECTED');
    });

    it('should use metadataId 0 for channel-level state changes', () => {
      const channel = createTestChannel();
      const processEventSpy = jest.spyOn(mockController, 'processEvent');
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.STARTED);

      expect(processEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'test-channel-1',
          metadataId: 0,
          state: ConnectionStatusEventType.CONNECTED,
          channelName: 'Test Channel',
        })
      );

      processEventSpy.mockRestore();
    });

    it('should emit stateChange event on the controller', (done) => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      mockController.onStateChange((connectorId, state) => {
        expect(connectorId).toBe('test-channel-1_0');
        expect(state.status).toBe(ConnectionStatusEventType.CONNECTED);
        done();
      });

      channel.updateCurrentState(DeployedState.STARTED);
    });

    it('should create log entries for state changes', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.STARTING);
      channel.updateCurrentState(DeployedState.STARTED);

      const logs = mockController.getChannelLog('test-channel-1', 10);
      expect(logs.length).toBe(2);
    });
  });

  describe('connector state changes', () => {
    it('should propagate connector state with correct metadataId', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      // Simulate a destination connector state change (metadataId 1)
      channel.emit('connectorStateChange', {
        channelId: 'test-channel-1',
        channelName: 'Test Channel',
        metaDataId: 1,
        connectorName: 'HTTP Sender',
        state: DeployedState.STARTED,
      });

      const states = mockController.getConnectionStatesForApi();
      expect(states['test-channel-1']).toBeDefined();

      const destState = states['test-channel-1']!.find((s) => s.metadataId === '1');
      expect(destState).toBeDefined();
      expect(destState!.status).toBe('CONNECTED');
    });

    it('should track multiple connectors independently', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      // Source connector (metadataId 0) - started
      channel.updateCurrentState(DeployedState.STARTED);

      // Destination 1 (metadataId 1) - started
      channel.emit('connectorStateChange', {
        channelId: 'test-channel-1',
        channelName: 'Test Channel',
        metaDataId: 1,
        connectorName: 'Dest 1',
        state: DeployedState.STARTED,
      });

      // Destination 2 (metadataId 2) - stopped
      channel.emit('connectorStateChange', {
        channelId: 'test-channel-1',
        channelName: 'Test Channel',
        metaDataId: 2,
        connectorName: 'Dest 2',
        state: DeployedState.STOPPED,
      });

      const states = mockController.getConnectionStatesForApi();
      const channelStates = states['test-channel-1']!;

      const source = channelStates.find((s) => s.metadataId === '0');
      const dest1 = channelStates.find((s) => s.metadataId === '1');
      const dest2 = channelStates.find((s) => s.metadataId === '2');

      expect(source!.status).toBe('CONNECTED');
      expect(dest1!.status).toBe('CONNECTED');
      expect(dest2!.status).toBe('DISCONNECTED');
    });

    it('should pass channelName from connector event', () => {
      const channel = createTestChannel();
      const processEventSpy = jest.spyOn(mockController, 'processEvent');
      wireChannelToDashboard(channel, 'Test Channel');

      channel.emit('connectorStateChange', {
        channelId: 'test-channel-1',
        channelName: 'Test Channel',
        metaDataId: 3,
        connectorName: 'JDBC Writer',
        state: DeployedState.STARTED,
      });

      expect(processEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'test-channel-1',
          metadataId: 3,
          state: ConnectionStatusEventType.CONNECTED,
          channelName: 'Test Channel',
        })
      );

      processEventSpy.mockRestore();
    });
  });

  describe('messageComplete events', () => {
    // Each test uses a unique channel ID to avoid cross-test throttle interference
    // (the messageCompleteLastEmit Map is module-level in EngineController.ts)

    it('should trigger CONNECTED state on messageComplete', () => {
      jest.useFakeTimers();
      const channelId = 'msg-complete-test-1';
      const channel = createTestChannel(channelId, 'Test Channel');
      wireChannelToDashboard(channel, 'Test Channel');

      jest.setSystemTime(new Date('2026-02-07T12:00:00.000Z'));

      channel.emit('messageComplete', {
        channelId,
        channelName: 'Test Channel',
        messageId: 1,
      });

      const states = mockController.getConnectionStatesForApi();
      const sourceState = states[channelId]?.find((s) => s.metadataId === '0');
      expect(sourceState).toBeDefined();
      expect(sourceState!.status).toBe('CONNECTED');

      jest.useRealTimers();
    });

    it('should use metadataId 0 for messageComplete events', () => {
      jest.useFakeTimers();
      const channelId = 'msg-complete-test-2';
      const channel = createTestChannel(channelId, 'Test Channel');
      const processEventSpy = jest.spyOn(mockController, 'processEvent');
      wireChannelToDashboard(channel, 'Test Channel');

      jest.setSystemTime(new Date('2026-02-07T13:00:00.000Z'));

      channel.emit('messageComplete', {
        channelId,
        channelName: 'Test Channel',
        messageId: 1,
      });

      expect(processEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId,
          metadataId: 0,
          state: ConnectionStatusEventType.CONNECTED,
          channelName: 'Test Channel',
        })
      );

      processEventSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should emit stateChange event since CONNECTED is a state event', () => {
      jest.useFakeTimers();
      const channelId = 'msg-complete-test-3';
      const channel = createTestChannel(channelId, 'Test Channel');
      wireChannelToDashboard(channel, 'Test Channel');

      const stateChangeSpy = jest.fn();
      mockController.onStateChange(stateChangeSpy);

      jest.setSystemTime(new Date('2026-02-07T14:00:00.000Z'));

      channel.emit('messageComplete', {
        channelId,
        channelName: 'Test Channel',
        messageId: 1,
      });

      expect(stateChangeSpy).toHaveBeenCalledWith(
        `${channelId}_0`,
        expect.objectContaining({
          status: ConnectionStatusEventType.CONNECTED,
        })
      );

      jest.useRealTimers();
    });
  });

  describe('throttling', () => {
    // Each test uses unique channel IDs to avoid cross-test throttle interference

    it('should throttle rapid messageComplete events to at most 1 per second', () => {
      jest.useFakeTimers();
      const channelId = 'throttle-test-1';
      const channel = createTestChannel(channelId, 'Test Channel');
      const processEventSpy = jest.spyOn(mockController, 'processEvent');
      wireChannelToDashboard(channel, 'Test Channel');

      // First event at T=0 - should go through
      jest.setSystemTime(new Date('2026-02-07T15:00:00.000Z'));
      channel.emit('messageComplete', { channelId, channelName: 'Test Channel', messageId: 1 });

      // Events at T+100ms, T+200ms, T+500ms - should all be suppressed
      jest.setSystemTime(new Date('2026-02-07T15:00:00.100Z'));
      channel.emit('messageComplete', { channelId, channelName: 'Test Channel', messageId: 2 });

      jest.setSystemTime(new Date('2026-02-07T15:00:00.200Z'));
      channel.emit('messageComplete', { channelId, channelName: 'Test Channel', messageId: 3 });

      jest.setSystemTime(new Date('2026-02-07T15:00:00.500Z'));
      channel.emit('messageComplete', { channelId, channelName: 'Test Channel', messageId: 4 });

      // Only 1 processEvent call for messageComplete within the first second
      const messageCompleteCalls = processEventSpy.mock.calls.filter(
        (call) => (call[0] as ConnectionStatusEvent).state === ConnectionStatusEventType.CONNECTED
      );
      expect(messageCompleteCalls.length).toBe(1);

      processEventSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should allow a new event after 1 second has passed', () => {
      jest.useFakeTimers();
      const channelId = 'throttle-test-2';
      const channel = createTestChannel(channelId, 'Test Channel');
      const processEventSpy = jest.spyOn(mockController, 'processEvent');
      wireChannelToDashboard(channel, 'Test Channel');

      // First event at T=0
      jest.setSystemTime(new Date('2026-02-07T16:00:00.000Z'));
      channel.emit('messageComplete', { channelId, channelName: 'Test Channel', messageId: 1 });

      // Suppressed at T+500ms
      jest.setSystemTime(new Date('2026-02-07T16:00:00.500Z'));
      channel.emit('messageComplete', { channelId, channelName: 'Test Channel', messageId: 2 });

      // Allowed at T+1001ms (past the 1-second window)
      jest.setSystemTime(new Date('2026-02-07T16:00:01.001Z'));
      channel.emit('messageComplete', { channelId, channelName: 'Test Channel', messageId: 3 });

      const messageCompleteCalls = processEventSpy.mock.calls.filter(
        (call) => (call[0] as ConnectionStatusEvent).state === ConnectionStatusEventType.CONNECTED
      );
      expect(messageCompleteCalls.length).toBe(2);

      processEventSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should throttle per channel independently', () => {
      jest.useFakeTimers();
      const channelId1 = 'throttle-indep-1';
      const channelId2 = 'throttle-indep-2';
      const channel1 = createTestChannel(channelId1, 'Channel 1');
      const channel2 = createTestChannel(channelId2, 'Channel 2');
      const processEventSpy = jest.spyOn(mockController, 'processEvent');

      wireChannelToDashboard(channel1, 'Channel 1');
      wireChannelToDashboard(channel2, 'Channel 2');

      // Both channels emit at T=0 - both should go through
      jest.setSystemTime(new Date('2026-02-07T17:00:00.000Z'));
      channel1.emit('messageComplete', { channelId: channelId1, channelName: 'Channel 1', messageId: 1 });
      channel2.emit('messageComplete', { channelId: channelId2, channelName: 'Channel 2', messageId: 1 });

      // Both emit again at T+100ms - both should be suppressed
      jest.setSystemTime(new Date('2026-02-07T17:00:00.100Z'));
      channel1.emit('messageComplete', { channelId: channelId1, channelName: 'Channel 1', messageId: 2 });
      channel2.emit('messageComplete', { channelId: channelId2, channelName: 'Channel 2', messageId: 2 });

      const messageCompleteCalls = processEventSpy.mock.calls.filter(
        (call) => (call[0] as ConnectionStatusEvent).state === ConnectionStatusEventType.CONNECTED
      );
      // 2 calls total - one per channel
      expect(messageCompleteCalls.length).toBe(2);

      processEventSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should not throttle stateChange events (only messageComplete)', () => {
      const channel = createTestChannel('throttle-no-state', 'Test Channel');
      const processEventSpy = jest.spyOn(mockController, 'processEvent');
      wireChannelToDashboard(channel, 'Test Channel');

      // Rapid state changes should all go through
      channel.updateCurrentState(DeployedState.STARTING);
      channel.updateCurrentState(DeployedState.STARTED);
      channel.updateCurrentState(DeployedState.PAUSING);
      channel.updateCurrentState(DeployedState.PAUSED);

      // All 4 state changes should have produced processEvent calls
      expect(processEventSpy).toHaveBeenCalledTimes(4);

      processEventSpy.mockRestore();
    });
  });

  describe('undeploy cleanup', () => {
    it('should clear all state via resetChannelState', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      // Generate some state
      channel.updateCurrentState(DeployedState.STARTED);
      channel.emit('connectorStateChange', {
        channelId: 'test-channel-1',
        channelName: 'Test Channel',
        metaDataId: 1,
        connectorName: 'Dest 1',
        state: DeployedState.STARTED,
      });

      // Verify state exists
      let states = mockController.getConnectionStatesForApi();
      expect(Object.keys(states)).toContain('test-channel-1');
      expect(states['test-channel-1']!.length).toBe(2); // source + dest

      // Simulate undeploy cleanup
      mockController.resetChannelState('test-channel-1');

      // Verify state is cleared
      states = mockController.getConnectionStatesForApi();
      expect(states['test-channel-1']).toBeUndefined();
    });

    it('should clear channel logs on resetChannelState', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      channel.updateCurrentState(DeployedState.STARTED);

      // Verify log exists
      expect(mockController.getChannelLog('test-channel-1', 10).length).toBeGreaterThan(0);

      mockController.resetChannelState('test-channel-1');

      // Channel-specific logs should be cleared
      expect(mockController.getChannelLog('test-channel-1', 10).length).toBe(0);
    });

    it('should not affect other channels on resetChannelState', () => {
      const channel1 = createTestChannel('test-channel-1', 'Channel 1');
      const channel2 = createTestChannel('test-channel-2', 'Channel 2');
      wireChannelToDashboard(channel1, 'Channel 1');
      wireChannelToDashboard(channel2, 'Channel 2');

      channel1.updateCurrentState(DeployedState.STARTED);
      channel2.updateCurrentState(DeployedState.STARTED);

      // Reset only channel 1
      mockController.resetChannelState('test-channel-1');

      // Channel 2 should still have state
      const states = mockController.getConnectionStatesForApi();
      expect(states['test-channel-1']).toBeUndefined();
      expect(states['test-channel-2']).toBeDefined();
      expect(states['test-channel-2']![0]!.status).toBe('CONNECTED');
    });
  });

  describe('deployedStateToConnectionStatus mapping completeness', () => {
    it('should map all DeployedState values without throwing', () => {
      const channel = createTestChannel();
      wireChannelToDashboard(channel, 'Test Channel');

      const allStates = Object.values(DeployedState);
      for (const state of allStates) {
        // Should not throw for any DeployedState value
        expect(() => channel.updateCurrentState(state)).not.toThrow();
      }

      // Verify a log entry was created for each state transition
      const logs = mockController.getChannelLog('test-channel-1', 100);
      expect(logs.length).toBe(allStates.length);
    });
  });
});
