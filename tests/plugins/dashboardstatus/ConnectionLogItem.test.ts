/**
 * Connection Log Item Tests
 */

import {
  ConnectionStatusEventType,
  createConnectionLogItem,
  serializeConnectionLogItem,
  parseConnectionStatusEventType,
  isStateEvent,
} from '../../../src/plugins/dashboardstatus/ConnectionLogItem';

describe('ConnectionLogItem', () => {
  describe('createConnectionLogItem', () => {
    it('should create a connection log item with all fields', () => {
      const item = createConnectionLogItem(
        1,
        'channel-123',
        0,
        ConnectionStatusEventType.CONNECTED,
        'Connection established',
        {
          serverId: 'server-1',
          channelName: 'Test Channel',
          connectorType: 'Source: TCP Listener',
          dateAdded: new Date('2026-01-15T10:30:00.000Z'),
        }
      );

      expect(item.logId).toBe(1);
      expect(item.channelId).toBe('channel-123');
      expect(item.metadataId).toBe(0);
      expect(item.eventState).toBe(ConnectionStatusEventType.CONNECTED);
      expect(item.information).toBe('Connection established');
      expect(item.serverId).toBe('server-1');
      expect(item.channelName).toBe('Test Channel');
      expect(item.connectorType).toBe('Source: TCP Listener');
    });

    it('should create with default options', () => {
      const item = createConnectionLogItem(
        1,
        'channel-456',
        1,
        ConnectionStatusEventType.IDLE,
        'No activity'
      );

      expect(item.logId).toBe(1);
      expect(item.channelId).toBe('channel-456');
      expect(item.metadataId).toBe(1);
      expect(item.serverId).toBeNull();
      expect(item.channelName).toBe('');
      expect(item.connectorType).toBe('');
      expect(item.dateAdded).toBeTruthy(); // Auto-generated
    });
  });

  describe('serializeConnectionLogItem', () => {
    it('should serialize to plain object', () => {
      const item = createConnectionLogItem(
        42,
        'channel-789',
        2,
        ConnectionStatusEventType.SENDING,
        'Sending data'
      );

      const serialized = serializeConnectionLogItem(item);

      expect(serialized.logId).toBe(42);
      expect(serialized.channelId).toBe('channel-789');
      expect(serialized.metadataId).toBe(2);
      expect(serialized.eventState).toBe('SENDING');
      expect(serialized.information).toBe('Sending data');
    });
  });

  describe('parseConnectionStatusEventType', () => {
    it('should parse valid event types', () => {
      expect(parseConnectionStatusEventType('IDLE')).toBe(ConnectionStatusEventType.IDLE);
      expect(parseConnectionStatusEventType('CONNECTED')).toBe(ConnectionStatusEventType.CONNECTED);
      expect(parseConnectionStatusEventType('READING')).toBe(ConnectionStatusEventType.READING);
      expect(parseConnectionStatusEventType('WRITING')).toBe(ConnectionStatusEventType.WRITING);
      expect(parseConnectionStatusEventType('SENDING')).toBe(ConnectionStatusEventType.SENDING);
      expect(parseConnectionStatusEventType('RECEIVING')).toBe(ConnectionStatusEventType.RECEIVING);
    });

    it('should handle case-insensitive input', () => {
      expect(parseConnectionStatusEventType('idle')).toBe(ConnectionStatusEventType.IDLE);
      expect(parseConnectionStatusEventType('Connected')).toBe(ConnectionStatusEventType.CONNECTED);
    });

    it('should return INFO for unknown types', () => {
      expect(parseConnectionStatusEventType('UNKNOWN')).toBe(ConnectionStatusEventType.INFO);
      expect(parseConnectionStatusEventType('')).toBe(ConnectionStatusEventType.INFO);
    });
  });

  describe('isStateEvent', () => {
    it('should return true for state events', () => {
      expect(isStateEvent(ConnectionStatusEventType.IDLE)).toBe(true);
      expect(isStateEvent(ConnectionStatusEventType.CONNECTED)).toBe(true);
      expect(isStateEvent(ConnectionStatusEventType.CONNECTING)).toBe(true);
      expect(isStateEvent(ConnectionStatusEventType.DISCONNECTED)).toBe(true);
      expect(isStateEvent(ConnectionStatusEventType.WAITING)).toBe(true);
    });

    it('should return false for transient events', () => {
      expect(isStateEvent(ConnectionStatusEventType.READING)).toBe(false);
      expect(isStateEvent(ConnectionStatusEventType.WRITING)).toBe(false);
      expect(isStateEvent(ConnectionStatusEventType.SENDING)).toBe(false);
      expect(isStateEvent(ConnectionStatusEventType.RECEIVING)).toBe(false);
      expect(isStateEvent(ConnectionStatusEventType.POLLING)).toBe(false);
      expect(isStateEvent(ConnectionStatusEventType.INFO)).toBe(false);
    });
  });

  describe('ConnectionStatusEventType enum', () => {
    it('should have all expected values', () => {
      expect(ConnectionStatusEventType.IDLE).toBe('IDLE');
      expect(ConnectionStatusEventType.READING).toBe('READING');
      expect(ConnectionStatusEventType.WRITING).toBe('WRITING');
      expect(ConnectionStatusEventType.POLLING).toBe('POLLING');
      expect(ConnectionStatusEventType.RECEIVING).toBe('RECEIVING');
      expect(ConnectionStatusEventType.SENDING).toBe('SENDING');
      expect(ConnectionStatusEventType.WAITING).toBe('WAITING');
      expect(ConnectionStatusEventType.CONNECTED).toBe('CONNECTED');
      expect(ConnectionStatusEventType.CONNECTING).toBe('CONNECTING');
      expect(ConnectionStatusEventType.DISCONNECTED).toBe('DISCONNECTED');
      expect(ConnectionStatusEventType.INFO).toBe('INFO');
    });
  });
});
