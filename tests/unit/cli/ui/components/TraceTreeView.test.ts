/**
 * TraceTreeView Component Tests
 *
 * Tests the tree flattening, status coloring, and content truncation logic.
 * Pure functions are duplicated here to match the codebase convention of
 * not importing from .tsx component files (which depend on ink/ESM).
 */

import { TraceNode, TraceResult } from '../../../../../src/cli/types/index.js';

// ─── Pure functions extracted from TraceTreeView.tsx ────────────────────────

/** Status to color mapping for trace nodes */
const STATUS_COLORS: Record<string, string> = {
  SENT: 'green',
  RECEIVED: 'green',
  TRANSFORMED: 'green',
  FILTERED: 'yellow',
  QUEUED: 'yellow',
  PENDING: 'yellow',
  ERROR: 'red',
};

/** Status to symbol mapping */
const STATUS_SYMBOLS: Record<string, string> = {
  SENT: '\u25CF',       // ●
  RECEIVED: '\u25CF',   // ●
  TRANSFORMED: '\u25CF',// ●
  FILTERED: '\u25CB',   // ○
  QUEUED: '\u25D0',     // ◐
  PENDING: '\u25D4',    // ◔
  ERROR: '\u2718',      // ✘
};

interface FlatNode {
  node: TraceNode;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  key: string;
}

function nodeKey(node: TraceNode, depth: number): string {
  return `${node.channelId}:${node.messageId}:${depth}`;
}

function flattenTree(
  node: TraceNode,
  expandedSet: Set<string>,
  depth: number = 0
): FlatNode[] {
  const key = `${node.channelId}:${node.messageId}:${depth}`;
  const expanded = expandedSet.has(key);
  const hasChildren = node.children.length > 0;

  const result: FlatNode[] = [{ node, depth, expanded, hasChildren, key }];

  if (expanded && hasChildren) {
    for (const child of node.children) {
      result.push(...flattenTree(child, expandedSet, depth + 1));
    }
  }

  return result;
}

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || 'gray';
}

function getStatusSymbol(status: string): string {
  return STATUS_SYMBOLS[status] || '?';
}

function truncateContent(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// ─── Test fixtures ──────────────────────────────────────────────────────────

function createTraceNode(overrides?: Partial<TraceNode>): TraceNode {
  return {
    channelId: 'ch-001',
    channelName: 'Test Channel',
    messageId: 1,
    receivedDate: '2026-02-06T10:00:00Z',
    status: 'SENT',
    connectorName: 'Source',
    depth: 0,
    children: [],
    ...overrides,
  };
}

function createTraceResult(overrides?: Partial<TraceResult>): TraceResult {
  return {
    root: createTraceNode(),
    totalNodes: 1,
    maxDepth: 0,
    totalLatencyMs: 10,
    hasErrors: false,
    truncated: false,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TraceTreeView', () => {
  describe('getStatusColor', () => {
    it('should return green for SENT', () => {
      expect(getStatusColor('SENT')).toBe('green');
    });

    it('should return green for RECEIVED', () => {
      expect(getStatusColor('RECEIVED')).toBe('green');
    });

    it('should return green for TRANSFORMED', () => {
      expect(getStatusColor('TRANSFORMED')).toBe('green');
    });

    it('should return yellow for FILTERED', () => {
      expect(getStatusColor('FILTERED')).toBe('yellow');
    });

    it('should return yellow for QUEUED', () => {
      expect(getStatusColor('QUEUED')).toBe('yellow');
    });

    it('should return yellow for PENDING', () => {
      expect(getStatusColor('PENDING')).toBe('yellow');
    });

    it('should return red for ERROR', () => {
      expect(getStatusColor('ERROR')).toBe('red');
    });

    it('should return gray for unknown status', () => {
      expect(getStatusColor('UNKNOWN')).toBe('gray');
      expect(getStatusColor('')).toBe('gray');
    });
  });

  describe('getStatusSymbol', () => {
    it('should return filled circle for SENT', () => {
      expect(getStatusSymbol('SENT')).toBe('\u25CF');
    });

    it('should return X for ERROR', () => {
      expect(getStatusSymbol('ERROR')).toBe('\u2718');
    });

    it('should return half circle for QUEUED', () => {
      expect(getStatusSymbol('QUEUED')).toBe('\u25D0');
    });

    it('should return empty circle for FILTERED', () => {
      expect(getStatusSymbol('FILTERED')).toBe('\u25CB');
    });

    it('should return ? for unknown status', () => {
      expect(getStatusSymbol('UNKNOWN')).toBe('?');
    });
  });

  describe('truncateContent', () => {
    it('should return short content unchanged', () => {
      expect(truncateContent('hello', 200)).toBe('hello');
    });

    it('should truncate long content with ellipsis', () => {
      const long = 'a'.repeat(300);
      const result = truncateContent(long, 200);
      expect(result.length).toBe(203); // 200 + '...'
      expect(result.endsWith('...')).toBe(true);
    });

    it('should handle exact-length content without truncation', () => {
      const exact = 'x'.repeat(200);
      expect(truncateContent(exact, 200)).toBe(exact);
    });

    it('should handle empty content', () => {
      expect(truncateContent('', 200)).toBe('');
    });

    it('should truncate at the specified max length', () => {
      const content = '0123456789';
      expect(truncateContent(content, 5)).toBe('01234...');
    });
  });

  describe('nodeKey', () => {
    it('should create a key from channelId, messageId, and depth', () => {
      const node = createTraceNode({ channelId: 'ch-001', messageId: 42 });
      expect(nodeKey(node, 0)).toBe('ch-001:42:0');
      expect(nodeKey(node, 3)).toBe('ch-001:42:3');
    });

    it('should produce unique keys for different nodes', () => {
      const node1 = createTraceNode({ channelId: 'ch-001', messageId: 1 });
      const node2 = createTraceNode({ channelId: 'ch-002', messageId: 1 });
      const node3 = createTraceNode({ channelId: 'ch-001', messageId: 2 });

      const keys = new Set([nodeKey(node1, 0), nodeKey(node2, 0), nodeKey(node3, 0)]);
      expect(keys.size).toBe(3);
    });
  });

  describe('flattenTree', () => {
    it('should flatten a single root node', () => {
      const root = createTraceNode();
      const expanded = new Set<string>();

      const result = flattenTree(root, expanded);

      expect(result).toHaveLength(1);
      expect(result[0]!.node).toBe(root);
      expect(result[0]!.depth).toBe(0);
      expect(result[0]!.hasChildren).toBe(false);
    });

    it('should include children of expanded nodes', () => {
      const child1 = createTraceNode({ channelId: 'ch-002', channelName: 'Child 1', messageId: 2 });
      const child2 = createTraceNode({ channelId: 'ch-003', channelName: 'Child 2', messageId: 3 });
      const root = createTraceNode({ children: [child1, child2] });

      const rootKey = nodeKey(root, 0);
      const expanded = new Set([rootKey]);

      const result = flattenTree(root, expanded);

      expect(result).toHaveLength(3);
      expect(result[0]!.node.channelName).toBe('Test Channel');
      expect(result[0]!.expanded).toBe(true);
      expect(result[1]!.node.channelName).toBe('Child 1');
      expect(result[1]!.depth).toBe(1);
      expect(result[2]!.node.channelName).toBe('Child 2');
      expect(result[2]!.depth).toBe(1);
    });

    it('should hide children of collapsed nodes', () => {
      const child = createTraceNode({ channelId: 'ch-002', messageId: 2 });
      const root = createTraceNode({ children: [child] });

      const expanded = new Set<string>(); // nothing expanded

      const result = flattenTree(root, expanded);

      expect(result).toHaveLength(1);
      expect(result[0]!.hasChildren).toBe(true);
      expect(result[0]!.expanded).toBe(false);
    });

    it('should handle deeply nested trees', () => {
      const grandchild = createTraceNode({ channelId: 'ch-003', messageId: 3, channelName: 'Grandchild' });
      const child = createTraceNode({ channelId: 'ch-002', messageId: 2, channelName: 'Child', children: [grandchild] });
      const root = createTraceNode({ children: [child] });

      const rootKey = nodeKey(root, 0);
      const childKey = 'ch-002:2:1'; // child at depth 1
      const expanded = new Set([rootKey, childKey]);

      const result = flattenTree(root, expanded);

      expect(result).toHaveLength(3);
      expect(result[0]!.depth).toBe(0);
      expect(result[1]!.depth).toBe(1);
      expect(result[2]!.depth).toBe(2);
      expect(result[2]!.node.channelName).toBe('Grandchild');
    });

    it('should mark nodes with children as hasChildren=true', () => {
      const child = createTraceNode({ channelId: 'ch-002', messageId: 2 });
      const root = createTraceNode({ children: [child] });

      const result = flattenTree(root, new Set());

      expect(result[0]!.hasChildren).toBe(true);
    });

    it('should mark leaf nodes as hasChildren=false', () => {
      const root = createTraceNode({ children: [] });

      const result = flattenTree(root, new Set());

      expect(result[0]!.hasChildren).toBe(false);
    });

    it('should partially expand: only expanded subtrees show children', () => {
      const leaf1 = createTraceNode({ channelId: 'ch-leaf1', messageId: 10 });
      const leaf2 = createTraceNode({ channelId: 'ch-leaf2', messageId: 11 });
      const child1 = createTraceNode({ channelId: 'ch-a', messageId: 2, children: [leaf1] });
      const child2 = createTraceNode({ channelId: 'ch-b', messageId: 3, children: [leaf2] });
      const root = createTraceNode({ children: [child1, child2] });

      const rootKey = nodeKey(root, 0);
      // Only expand root and child1, not child2
      const child1Key = 'ch-a:2:1';
      const expanded = new Set([rootKey, child1Key]);

      const result = flattenTree(root, expanded);

      // root, child1, leaf1, child2 (child2's leaf2 hidden)
      expect(result).toHaveLength(4);
      expect(result[0]!.node.channelId).toBe('ch-001');
      expect(result[1]!.node.channelId).toBe('ch-a');
      expect(result[2]!.node.channelId).toBe('ch-leaf1');
      expect(result[3]!.node.channelId).toBe('ch-b');
      expect(result[3]!.expanded).toBe(false);
    });
  });

  describe('component props interface', () => {
    it('should define expected trace result shape', () => {
      const result = createTraceResult({
        totalNodes: 5,
        maxDepth: 3,
        totalLatencyMs: 120,
        hasErrors: true,
        truncated: false,
      });

      expect(result.totalNodes).toBe(5);
      expect(result.maxDepth).toBe(3);
      expect(result.totalLatencyMs).toBe(120);
      expect(result.hasErrors).toBe(true);
      expect(result.truncated).toBe(false);
    });

    it('should support nodes with content', () => {
      const node = createTraceNode({
        content: {
          raw: { content: 'MSH|...', dataType: 'HL7V2', truncated: false, fullLength: 200 },
          transformed: { content: '<xml>...', dataType: 'XML', truncated: true, fullLength: 5000 },
        },
      });

      expect(node.content!.raw!.dataType).toBe('HL7V2');
      expect(node.content!.transformed!.truncated).toBe(true);
    });

    it('should support nodes with errors', () => {
      const node = createTraceNode({
        status: 'ERROR',
        error: 'Connection refused',
        content: {
          processingError: 'java.net.ConnectException: Connection refused',
        },
      });

      expect(node.status).toBe('ERROR');
      expect(node.error).toBe('Connection refused');
      expect(node.content!.processingError).toContain('Connection refused');
    });
  });
});
