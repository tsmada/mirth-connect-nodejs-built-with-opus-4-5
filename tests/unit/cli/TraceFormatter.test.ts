// Mock chalk v5 (ESM-only) for Jest CJS environment
// Creates a proxy that acts as a pass-through: chalk.red('foo') => 'foo'
jest.mock('chalk', () => {
  const passthrough = (...args: unknown[]) => args[0];
  const makeChain = (): unknown => new Proxy(passthrough, {
    get: (_target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      return makeChain();
    },
    apply: (_target, _thisArg, args) => args[0],
  });
  return { __esModule: true, default: makeChain() };
});

import { formatTraceTree } from '../../../src/cli/lib/TraceFormatter';
import { TraceResult, TraceNode } from '../../../src/cli/types/index';

// With chalk mocked, output is plain text (no ANSI)
function stripAnsi(str: string): string {
  return str;
}

describe('TraceFormatter', () => {
  function makeNode(overrides: Partial<TraceNode> = {}): TraceNode {
    return {
      channelId: 'ch-001',
      channelName: 'Test Channel',
      messageId: 1,
      receivedDate: '2026-02-06T14:30:45.123Z',
      status: 'SENT',
      connectorName: 'Source',
      depth: 0,
      children: [],
      ...overrides,
    };
  }

  function makeResult(rootOverrides: Partial<TraceNode> = {}, resultOverrides: Partial<TraceResult> = {}): TraceResult {
    return {
      root: makeNode(rootOverrides),
      totalNodes: 1,
      maxDepth: 0,
      totalLatencyMs: 0,
      hasErrors: false,
      truncated: false,
      ...resultOverrides,
    };
  }

  describe('single node (root only)', () => {
    it('should format a single node with no children', () => {
      const result = makeResult();
      const output = stripAnsi(formatTraceTree(result));

      expect(output).toContain('Message Trace:');
      expect(output).toContain('Test Channel');
      expect(output).toContain('Hops: 1');
      expect(output).toContain('Depth: 0');
      expect(output).toContain('[SENT]');
      expect(output).toContain('msg #1');
    });

    it('should show latency in summary', () => {
      const result = makeResult({}, { totalLatencyMs: 456 });
      const output = stripAnsi(formatTraceTree(result));

      expect(output).toContain('Latency: 456ms');
    });

    it('should show error count when errors exist', () => {
      const result = makeResult(
        { status: 'ERROR', error: 'Connection refused' },
        { hasErrors: true }
      );
      const output = stripAnsi(formatTraceTree(result));

      expect(output).toContain('Errors: 1');
      expect(output).toContain('[ERROR]');
      expect(output).toContain('Connection refused');
    });
  });

  describe('linear chain (A -> B -> C)', () => {
    it('should format a linear 3-hop trace', () => {
      const result = makeResult({
        channelName: 'ADT Receiver',
        children: [
          makeNode({
            channelId: 'ch-002',
            channelName: 'HL7 Router',
            messageId: 2,
            latencyMs: 111,
            depth: 1,
            children: [
              makeNode({
                channelId: 'ch-003',
                channelName: 'EMR Writer',
                messageId: 3,
                latencyMs: 222,
                depth: 2,
              }),
            ],
          }),
        ],
      }, { totalNodes: 3, maxDepth: 2, totalLatencyMs: 222 });

      const output = stripAnsi(formatTraceTree(result));

      // Verify chain structure
      expect(output).toContain('ADT Receiver');
      expect(output).toContain('HL7 Router');
      expect(output).toContain('EMR Writer');
      expect(output).toContain('+111ms');
      expect(output).toContain('+222ms');
      expect(output).toContain('Hops: 3');
    });
  });

  describe('fan-out (A -> B, C)', () => {
    it('should format a tree with multiple children', () => {
      const result = makeResult({
        channelName: 'ADT Receiver',
        children: [
          makeNode({
            channelId: 'ch-002',
            channelName: 'EMR Writer',
            messageId: 2,
            latencyMs: 111,
            depth: 1,
          }),
          makeNode({
            channelId: 'ch-003',
            channelName: 'Audit Log',
            messageId: 3,
            latencyMs: 177,
            depth: 1,
            status: 'ERROR',
            error: 'Connection refused: localhost:5432',
          }),
        ],
      }, { totalNodes: 3, maxDepth: 1, totalLatencyMs: 177, hasErrors: true });

      const output = stripAnsi(formatTraceTree(result));

      expect(output).toContain('EMR Writer');
      expect(output).toContain('Audit Log');
      expect(output).toContain('Errors: 1');
      expect(output).toContain('Connection refused');
    });
  });

  describe('content display', () => {
    it('should show content snapshots when enabled', () => {
      const result = makeResult({
        content: {
          raw: {
            content: 'MSH|^~\\&|EPIC|FACILITY|MIRTH||20260206||ADT^A01|123|P|2.3',
            dataType: 'HL7V2',
            truncated: false,
            fullLength: 55,
          },
          transformed: {
            content: '<Patient><name>Smith</name></Patient>',
            dataType: 'XML',
            truncated: false,
            fullLength: 37,
          },
        },
      });

      const output = stripAnsi(formatTraceTree(result, { showContent: true, maxPreviewLength: 200 }));

      expect(output).toContain('RAW:');
      expect(output).toContain('MSH|');
      expect(output).toContain('TRANSFORMED:');
      expect(output).toContain('<Patient>');
    });

    it('should hide content when disabled', () => {
      const result = makeResult({
        content: {
          raw: {
            content: 'MSH|^~\\&|EPIC|',
            dataType: 'HL7V2',
            truncated: false,
            fullLength: 14,
          },
        },
      });

      const output = stripAnsi(formatTraceTree(result, { showContent: false, maxPreviewLength: 200 }));

      expect(output).not.toContain('RAW:');
      expect(output).not.toContain('MSH|');
    });

    it('should show processing error', () => {
      const result = makeResult({
        status: 'ERROR',
        content: {
          processingError: 'java.lang.NullPointerException at line 42',
        },
      }, { hasErrors: true });

      const output = stripAnsi(formatTraceTree(result, { showContent: true, maxPreviewLength: 200 }));

      expect(output).toContain('ERROR:');
      expect(output).toContain('NullPointerException');
    });
  });

  describe('truncation indicator', () => {
    it('should show truncation warning when result is truncated', () => {
      const result = makeResult({}, { truncated: true });
      const output = stripAnsi(formatTraceTree(result));

      expect(output).toContain('trace truncated');
    });

    it('should not show truncation warning when not truncated', () => {
      const result = makeResult({}, { truncated: false });
      const output = stripAnsi(formatTraceTree(result));

      expect(output).not.toContain('trace truncated');
    });
  });

  describe('status icons and colors', () => {
    it('should handle all status types without error', () => {
      const statuses = ['SENT', 'FILTERED', 'ERROR', 'QUEUED', 'RECEIVED', 'TRANSFORMED', 'PENDING', 'DELETED', 'UNKNOWN'];

      for (const status of statuses) {
        const result = makeResult({ status });
        // Should not throw
        const output = formatTraceTree(result);
        expect(output).toBeTruthy();
      }
    });
  });

  describe('parent destination name', () => {
    it('should show the destination connector that spawned the child', () => {
      const result = makeResult({
        channelName: 'ADT Receiver',
        children: [
          makeNode({
            channelId: 'ch-002',
            channelName: 'EMR Writer',
            messageId: 2,
            depth: 1,
            parentDestinationName: 'Send to EMR',
          }),
        ],
      }, { totalNodes: 2, maxDepth: 1 });

      const output = stripAnsi(formatTraceTree(result));

      expect(output).toContain('via Send to EMR');
    });
  });
});
