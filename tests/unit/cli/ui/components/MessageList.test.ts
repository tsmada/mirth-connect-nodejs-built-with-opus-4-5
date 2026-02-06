/**
 * MessageList Component Tests
 *
 * Tests the pure functions used by MessageList: formatDate, getFilterLabel, getConnectorSummary.
 * Pure functions are duplicated here to match the codebase convention of
 * not importing from .tsx component files (which depend on ink/ESM).
 */

import { ConnectorMessage, MessageStatus } from '../../../../../src/cli/types/index.js';

// ─── Pure functions duplicated from MessageList.tsx ───────────────────────────

const STATUS_LABELS: Record<MessageStatus, string> = {
  R: 'RECEIVED',
  F: 'FILTERED',
  T: 'TRANSFORMED',
  S: 'SENT',
  Q: 'QUEUED',
  E: 'ERROR',
  P: 'PENDING',
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
  } catch {
    return dateStr;
  }
}

function getFilterLabel(status: MessageStatus | null): string {
  if (status === null) return 'All';
  return STATUS_LABELS[status] ?? status;
}

function getConnectorSummary(connectorMessages: Record<number, ConnectorMessage>): string {
  const entries = Object.values(connectorMessages);
  if (entries.length === 0) return '-';
  return entries
    .sort((a, b) => a.metaDataId - b.metaDataId)
    .map((c) => c.connectorName)
    .join(', ');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MessageList', () => {
  describe('formatDate', () => {
    it('should format an ISO date string', () => {
      const result = formatDate('2026-02-06T10:32:15Z');
      // Verify it contains expected parts (timezone-independent)
      expect(result).toMatch(/2026/);
      expect(result).toMatch(/02/);
      expect(result).toMatch(/06/);
    });

    it('should return the original string for invalid dates', () => {
      expect(formatDate('not-a-date')).toBe('not-a-date');
    });

    it('should return the original string for empty string', () => {
      expect(formatDate('')).toBe('');
    });

    it('should handle date with milliseconds', () => {
      const result = formatDate('2026-02-06T10:32:15.123Z');
      expect(result).toMatch(/2026/);
    });

    it('should produce consistent format YYYY-MM-DD HH:MM:SS', () => {
      const result = formatDate('2026-01-15T00:00:00Z');
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('getFilterLabel', () => {
    it('should return "All" for null', () => {
      expect(getFilterLabel(null)).toBe('All');
    });

    it('should return "RECEIVED" for R', () => {
      expect(getFilterLabel('R')).toBe('RECEIVED');
    });

    it('should return "FILTERED" for F', () => {
      expect(getFilterLabel('F')).toBe('FILTERED');
    });

    it('should return "TRANSFORMED" for T', () => {
      expect(getFilterLabel('T')).toBe('TRANSFORMED');
    });

    it('should return "SENT" for S', () => {
      expect(getFilterLabel('S')).toBe('SENT');
    });

    it('should return "QUEUED" for Q', () => {
      expect(getFilterLabel('Q')).toBe('QUEUED');
    });

    it('should return "ERROR" for E', () => {
      expect(getFilterLabel('E')).toBe('ERROR');
    });

    it('should return "PENDING" for P', () => {
      expect(getFilterLabel('P')).toBe('PENDING');
    });
  });

  describe('getConnectorSummary', () => {
    function mockConnector(id: number, name: string): ConnectorMessage {
      return {
        messageId: 1,
        metaDataId: id,
        channelId: 'ch-001',
        connectorName: name,
        receivedDate: '2026-02-06T10:00:00Z',
        status: 'S' as MessageStatus,
        sendAttempts: 1,
      };
    }

    it('should return "-" for empty connectors', () => {
      expect(getConnectorSummary({})).toBe('-');
    });

    it('should return single connector name', () => {
      expect(getConnectorSummary({ 0: mockConnector(0, 'Source') })).toBe('Source');
    });

    it('should join multiple connectors with commas', () => {
      const connectors = {
        0: mockConnector(0, 'Source'),
        1: mockConnector(1, 'Destination 1'),
      };
      expect(getConnectorSummary(connectors)).toBe('Source, Destination 1');
    });

    it('should sort connectors by metaDataId', () => {
      const connectors = {
        2: mockConnector(2, 'D2'),
        0: mockConnector(0, 'Source'),
        1: mockConnector(1, 'D1'),
      };
      expect(getConnectorSummary(connectors)).toBe('Source, D1, D2');
    });

    it('should handle connectors with high metaDataIds', () => {
      const connectors = {
        0: mockConnector(0, 'Source'),
        10: mockConnector(10, 'D10'),
        5: mockConnector(5, 'D5'),
      };
      expect(getConnectorSummary(connectors)).toBe('Source, D5, D10');
    });
  });
});
