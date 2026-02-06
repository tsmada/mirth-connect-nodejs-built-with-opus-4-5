/**
 * MessageDetail Component Tests
 *
 * Tests the pure functions used by MessageDetail: getContentTypeLabel, sortConnectors, truncateContent.
 * Pure functions are duplicated here to match the codebase convention of
 * not importing from .tsx component files (which depend on ink/ESM).
 */

import { ConnectorMessage, MessageStatus } from '../../../../../src/cli/types/index.js';

// ─── Pure functions duplicated from MessageDetail.tsx ─────────────────────────

const CONTENT_TYPE_LABELS: Record<number, string> = {
  1: 'RAW',
  2: 'PROCESSED_RAW',
  3: 'TRANSFORMED',
  4: 'ENCODED',
  5: 'SENT',
  6: 'RESPONSE',
  7: 'RESPONSE_TRANSFORMED',
  8: 'PROCESSED_RESPONSE',
  9: 'CONNECTOR_MAP',
  10: 'CHANNEL_MAP',
  11: 'RESPONSE_MAP',
  12: 'PROCESSING_ERROR',
  13: 'POSTPROCESSOR_ERROR',
  14: 'SOURCE_MAP',
};

function getContentTypeLabel(key: number | string): string {
  if (typeof key === 'number') {
    return CONTENT_TYPE_LABELS[key] ?? `TYPE_${key}`;
  }
  return String(key);
}

function sortConnectors(connectorMessages: Record<number, ConnectorMessage>): ConnectorMessage[] {
  return Object.values(connectorMessages).sort((a, b) => a.metaDataId - b.metaDataId);
}

function truncateContent(text: string, maxLength: number = 500): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MessageDetail', () => {
  describe('getContentTypeLabel', () => {
    it('should return RAW for type 1', () => {
      expect(getContentTypeLabel(1)).toBe('RAW');
    });

    it('should return PROCESSED_RAW for type 2', () => {
      expect(getContentTypeLabel(2)).toBe('PROCESSED_RAW');
    });

    it('should return TRANSFORMED for type 3', () => {
      expect(getContentTypeLabel(3)).toBe('TRANSFORMED');
    });

    it('should return ENCODED for type 4', () => {
      expect(getContentTypeLabel(4)).toBe('ENCODED');
    });

    it('should return SENT for type 5', () => {
      expect(getContentTypeLabel(5)).toBe('SENT');
    });

    it('should return RESPONSE for type 6', () => {
      expect(getContentTypeLabel(6)).toBe('RESPONSE');
    });

    it('should return SOURCE_MAP for type 14', () => {
      expect(getContentTypeLabel(14)).toBe('SOURCE_MAP');
    });

    it('should return TYPE_99 for unknown numeric type', () => {
      expect(getContentTypeLabel(99)).toBe('TYPE_99');
    });

    it('should return the string as-is for string input', () => {
      expect(getContentTypeLabel('RAW')).toBe('RAW');
      expect(getContentTypeLabel('CUSTOM')).toBe('CUSTOM');
    });
  });

  describe('sortConnectors', () => {
    function mockConnector(id: number, name: string, status: MessageStatus = 'S'): ConnectorMessage {
      return {
        messageId: 1,
        metaDataId: id,
        channelId: 'ch-001',
        connectorName: name,
        receivedDate: '2026-02-06T10:00:00Z',
        status,
        sendAttempts: 1,
      };
    }

    it('should return empty array for empty input', () => {
      expect(sortConnectors({})).toEqual([]);
    });

    it('should return single connector', () => {
      const result = sortConnectors({ 0: mockConnector(0, 'Source') });
      expect(result).toHaveLength(1);
      expect(result[0]!.connectorName).toBe('Source');
    });

    it('should sort by metaDataId ascending', () => {
      const connectors = {
        2: mockConnector(2, 'D2'),
        0: mockConnector(0, 'Source'),
        1: mockConnector(1, 'D1'),
      };
      const result = sortConnectors(connectors);
      expect(result.map((c) => c.metaDataId)).toEqual([0, 1, 2]);
      expect(result.map((c) => c.connectorName)).toEqual(['Source', 'D1', 'D2']);
    });

    it('should preserve all connector data after sorting', () => {
      const conn = mockConnector(0, 'Source', 'E');
      conn.sendAttempts = 3;
      const result = sortConnectors({ 0: conn });
      expect(result[0]!.status).toBe('E');
      expect(result[0]!.sendAttempts).toBe(3);
    });
  });

  describe('truncateContent', () => {
    it('should return content as-is when under limit', () => {
      expect(truncateContent('short', 500)).toBe('short');
    });

    it('should return content as-is when exactly at limit', () => {
      const text = 'a'.repeat(500);
      expect(truncateContent(text, 500)).toBe(text);
    });

    it('should truncate and add ellipsis when over limit', () => {
      const text = 'a'.repeat(600);
      const result = truncateContent(text, 500);
      expect(result.length).toBe(503); // 500 + '...'
      expect(result.endsWith('...')).toBe(true);
    });

    it('should use default limit of 500', () => {
      const text = 'b'.repeat(501);
      const result = truncateContent(text);
      expect(result.length).toBe(503);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should handle empty string', () => {
      expect(truncateContent('', 500)).toBe('');
    });

    it('should handle custom max length', () => {
      const text = 'hello world';
      const result = truncateContent(text, 5);
      expect(result).toBe('hello...');
    });
  });
});
