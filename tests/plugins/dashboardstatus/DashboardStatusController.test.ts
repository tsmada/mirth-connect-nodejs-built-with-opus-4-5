/**
 * Dashboard Status Controller Tests
 */

import {
  DashboardStatusController,
  ConnectionStatusEvent,
  ConnectorCountEvent,
} from '../../../src/plugins/dashboardstatus/DashboardStatusController';
import { ConnectionStatusEventType, ConnectionLogItem } from '../../../src/plugins/dashboardstatus/ConnectionLogItem';
import { ConnectionStateItem } from '../../../src/plugins/dashboardstatus/ConnectionStateItem';

describe('DashboardStatusController', () => {
  let controller: DashboardStatusController;

  beforeEach(() => {
    controller = new DashboardStatusController();
    controller.setServerId('test-server');
  });

  describe('setServerId/getServerId', () => {
    it('should set and get server ID', () => {
      controller.setServerId('new-server');
      expect(controller.getServerId()).toBe('new-server');
    });
  });

  describe('processEvent', () => {
    it('should process a basic connection status event', () => {
      const event: ConnectionStatusEvent = {
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        message: 'Client connected',
        channelName: 'Test Channel',
        connectorType: 'Source: TCP Listener',
      };

      controller.processEvent(event);

      const log = controller.getChannelLog('channel-1', 10);
      expect(log.length).toBe(1);
      expect(log[0]!.eventState).toBe(ConnectionStatusEventType.CONNECTED);
      expect(log[0]!.information).toBe('Client connected');
    });

    it('should process a connector count event with increment', () => {
      const event: ConnectorCountEvent = {
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        increment: true,
        maximum: 10,
      };

      controller.processEvent(event);

      const state = controller.getConnectorState('channel-1', 0);
      expect(state).not.toBeNull();
      expect(state!.connectionCount).toBe(1);
      expect(state!.maxConnectionCount).toBe(10);
    });

    it('should decrement connection count', () => {
      // First increment
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        increment: true,
        maximum: 10,
      } as ConnectorCountEvent);

      // Then decrement
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        increment: false,
      } as ConnectorCountEvent);

      const state = controller.getConnectorState('channel-1', 0);
      expect(state!.connectionCount).toBe(0);
      expect(state!.status).toBe(ConnectionStatusEventType.IDLE); // Count 0 means IDLE
    });

    it('should not go below 0 connection count', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        increment: false,
      } as ConnectorCountEvent);

      const state = controller.getConnectorState('channel-1', 0);
      expect(state!.connectionCount).toBe(0);
    });

    it('should emit connectionLog event', (done) => {
      controller.onConnectionLog((item: ConnectionLogItem) => {
        expect(item.channelId).toBe('channel-1');
        expect(item.eventState).toBe(ConnectionStatusEventType.IDLE);
        done();
      });

      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.IDLE,
        message: 'Idle',
      });
    });

    it('should emit stateChange event for state events', (done) => {
      controller.onStateChange((connectorId: string, state: ConnectionStateItem) => {
        expect(connectorId).toBe('channel-1_0');
        expect(state.status).toBe(ConnectionStatusEventType.CONNECTED);
        done();
      });

      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        message: 'Connected',
      });
    });
  });

  describe('getChannelLog', () => {
    beforeEach(() => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        message: 'Message 1',
      });
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.READING,
        message: 'Message 2',
      });
      controller.processEvent({
        channelId: 'channel-2',
        metadataId: 0,
        state: ConnectionStatusEventType.IDLE,
        message: 'Message 3',
      });
    });

    it('should return logs for specific channel', () => {
      const logs = controller.getChannelLog('channel-1', 10);

      expect(logs.length).toBe(2);
      expect(logs.every((l) => l.channelId === 'channel-1')).toBe(true);
    });

    it('should return all logs when channelId is null', () => {
      const logs = controller.getChannelLog(null, 10);

      expect(logs.length).toBe(3);
    });

    it('should respect fetchSize limit', () => {
      const logs = controller.getChannelLog(null, 2);

      expect(logs.length).toBe(2);
    });

    it('should filter by lastLogId', () => {
      const allLogs = controller.getChannelLog(null, 10);
      const firstLogId = allLogs[2]!.logId;

      const newLogs = controller.getChannelLog(null, 10, firstLogId);

      expect(newLogs.length).toBe(2);
    });
  });

  describe('getConnectorStateMap', () => {
    it('should return state map', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
      });
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 1,
        state: ConnectionStatusEventType.IDLE,
      });

      const stateMap = controller.getConnectorStateMap();

      expect(stateMap.size).toBe(2);
      expect(stateMap.has('channel-1_0')).toBe(true);
      expect(stateMap.has('channel-1_1')).toBe(true);
    });

    it('should return state map for API', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
      });

      const stateMap = controller.getConnectorStateMapForApi();

      expect(stateMap['channel-1_0']).toBeDefined();
      expect(stateMap['channel-1_0']!.color).toBeTruthy();
      expect(stateMap['channel-1_0']!.state).toBe('CONNECTED');
    });
  });

  describe('getConnectionStates', () => {
    it('should return connection states grouped by channel', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
      });
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 1,
        state: ConnectionStatusEventType.IDLE,
      });
      controller.processEvent({
        channelId: 'channel-2',
        metadataId: 0,
        state: ConnectionStatusEventType.WAITING,
      });

      const states = controller.getConnectionStates();

      expect(states.size).toBe(2);
      expect(states.get('channel-1')?.length).toBe(2);
      expect(states.get('channel-2')?.length).toBe(1);
    });

    it('should return for API', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
      });

      const states = controller.getConnectionStatesForApi();

      expect(states['channel-1']).toBeDefined();
      expect(states['channel-1']!.length).toBe(1);
      expect(states['channel-1']![0]!.status).toBe('CONNECTED');
    });
  });

  describe('clearChannelLog', () => {
    it('should clear logs for specific channel', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
      });
      controller.processEvent({
        channelId: 'channel-2',
        metadataId: 0,
        state: ConnectionStatusEventType.IDLE,
      });

      controller.clearChannelLog('channel-1');

      expect(controller.getChannelLog('channel-1', 10).length).toBe(0);
      expect(controller.getChannelLog('channel-2', 10).length).toBe(1);
    });
  });

  describe('clearAllLogs', () => {
    it('should clear all logs', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
      });
      controller.processEvent({
        channelId: 'channel-2',
        metadataId: 0,
        state: ConnectionStatusEventType.IDLE,
      });

      controller.clearAllLogs();

      expect(controller.getChannelLog(null, 10).length).toBe(0);
    });
  });

  describe('resetConnectorState', () => {
    it('should reset state for specific connector', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
        increment: true,
        maximum: 10,
      } as ConnectorCountEvent);

      controller.resetConnectorState('channel-1', 0);

      expect(controller.getConnectorState('channel-1', 0)).toBeNull();
    });
  });

  describe('resetChannelState', () => {
    it('should reset all state for a channel', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
      });
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 1,
        state: ConnectionStatusEventType.IDLE,
      });
      controller.processEvent({
        channelId: 'channel-2',
        metadataId: 0,
        state: ConnectionStatusEventType.WAITING,
      });

      controller.resetChannelState('channel-1');

      expect(controller.getConnectorState('channel-1', 0)).toBeNull();
      expect(controller.getConnectorState('channel-1', 1)).toBeNull();
      expect(controller.getConnectorState('channel-2', 0)).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      controller.processEvent({
        channelId: 'channel-1',
        metadataId: 0,
        state: ConnectionStatusEventType.CONNECTED,
      });
      controller.processEvent({
        channelId: 'channel-2',
        metadataId: 0,
        state: ConnectionStatusEventType.IDLE,
      });

      const stats = controller.getStats();

      expect(stats.totalLogs).toBe(2);
      expect(stats.channelCount).toBe(2);
      expect(stats.connectorCount).toBe(2);
    });
  });
});
