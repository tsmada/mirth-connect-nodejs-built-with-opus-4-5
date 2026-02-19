/**
 * TraceTreeView Component
 *
 * Renders a cross-channel message trace as a scrollable, collapsible tree.
 * Each node represents a message at a point in the channel pipeline, with
 * color-coded status indicators and optional content previews.
 */

import React, { FC, useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TraceResult, TraceNode, ContentSnapshot } from '../../types/index.js';

export interface TraceTreeViewProps {
  /** Complete trace result from the API */
  traceData: TraceResult;
  /** Whether to show full content (2000 chars vs 200 chars) */
  verbose: boolean;
  /** Called when user closes the view (Escape) */
  onClose: () => void;
  /** Called when user toggles verbose mode (v key) */
  onToggleVerbose: () => void;
}

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
  SENT: '\u25CF', // ●
  RECEIVED: '\u25CF', // ●
  TRANSFORMED: '\u25CF', // ●
  FILTERED: '\u25CB', // ○
  QUEUED: '\u25D0', // ◐
  PENDING: '\u25D4', // ◔
  ERROR: '\u2718', // ✘
};

/** Content type display labels */
const CONTENT_LABELS: Record<string, string> = {
  raw: 'Raw',
  transformed: 'Transformed',
  encoded: 'Encoded',
  sent: 'Sent',
  response: 'Response',
  processingError: 'Error',
};

interface FlatNode {
  node: TraceNode;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  key: string;
}

/**
 * Flatten a trace tree into a list of visible nodes.
 * Only includes children of expanded nodes.
 */
export function flattenTree(
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

/**
 * Get the color for a message status string.
 */
export function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || 'gray';
}

/**
 * Get the symbol for a message status string.
 */
export function getStatusSymbol(status: string): string {
  return STATUS_SYMBOLS[status] || '?';
}

/**
 * Truncate content for display.
 */
export function truncateContent(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Build the node key for expanded state tracking.
 */
export function nodeKey(node: TraceNode, depth: number): string {
  return `${node.channelId}:${node.messageId}:${depth}`;
}

/**
 * TraceTreeView component
 */
export const TraceTreeView: FC<TraceTreeViewProps> = ({
  traceData,
  verbose,
  onClose,
  onToggleVerbose,
}) => {
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => {
    // Start with root expanded
    const initial = new Set<string>();
    initial.add(nodeKey(traceData.root, 0));
    return initial;
  });
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const flatNodes = useMemo(
    () => flattenTree(traceData.root, expandedSet),
    [traceData.root, expandedSet]
  );

  const termHeight = process.stdout.rows || 24;
  // Reserve lines for header (3), footer (2), summary (2), borders (2)
  const visibleRows = Math.max(5, termHeight - 9);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (input === 'v' || input === 'V') {
      onToggleVerbose();
      return;
    }

    // Navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => {
        const next = Math.max(0, prev - 1);
        // Scroll up if needed
        if (next < scrollOffset) {
          setScrollOffset(next);
        }
        return next;
      });
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => {
        const next = Math.min(flatNodes.length - 1, prev + 1);
        // Scroll down if needed
        if (next >= scrollOffset + visibleRows) {
          setScrollOffset(next - visibleRows + 1);
        }
        return next;
      });
      return;
    }

    // Toggle expand/collapse
    if (key.return || input === ' ') {
      const current = flatNodes[selectedIndex];
      if (current && current.hasChildren) {
        setExpandedSet((prev) => {
          const next = new Set(prev);
          if (next.has(current.key)) {
            next.delete(current.key);
          } else {
            next.add(current.key);
          }
          return next;
        });
      }
      return;
    }
  });

  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(90, termWidth - 2);
  const contentMaxLen = verbose ? 2000 : 200;

  // Visible slice of flat nodes
  const visibleNodes = flatNodes.slice(scrollOffset, scrollOffset + visibleRows);

  const renderContentSnapshot = (label: string, snapshot: ContentSnapshot) => {
    const displayContent = truncateContent(snapshot.content, contentMaxLen);
    const lines = displayContent.split('\n').slice(0, verbose ? 10 : 3);

    return React.createElement(
      Box,
      { key: label, flexDirection: 'column', marginLeft: 2 },
      React.createElement(
        Box,
        { flexDirection: 'row' },
        React.createElement(Text, { color: 'cyan', dimColor: true }, `${label}: `),
        React.createElement(
          Text,
          { dimColor: true },
          snapshot.truncated ? `[${snapshot.fullLength} chars, truncated]` : ''
        )
      ),
      ...lines.map((line, i) =>
        React.createElement(Text, { key: `${label}-${i}`, color: 'gray' }, `  ${line}`)
      )
    );
  };

  const renderNode = (flatNode: FlatNode, index: number) => {
    const { node, depth, expanded, hasChildren } = flatNode;
    const isSelected = index + scrollOffset === selectedIndex;
    const indent = '  '.repeat(depth);
    const toggle = hasChildren ? (expanded ? '\u25BC ' : '\u25B6 ') : '  ';
    const statusColor = getStatusColor(node.status);
    const statusSymbol = getStatusSymbol(node.status);

    const nodeElements: React.ReactElement[] = [];

    // Main node line
    nodeElements.push(
      React.createElement(
        Box,
        { key: 'main', flexDirection: 'row' },
        React.createElement(Text, { color: isSelected ? 'cyan' : 'white' }, indent + toggle),
        React.createElement(Text, { color: statusColor }, statusSymbol + ' '),
        React.createElement(
          Text,
          { bold: isSelected, color: isSelected ? 'cyan' : 'white' },
          node.channelName
        ),
        React.createElement(Text, { color: 'gray' }, ` #${node.messageId}`),
        React.createElement(Text, { color: 'gray' }, ` [${node.connectorName}]`),
        React.createElement(Text, { color: statusColor }, ` ${node.status}`),
        node.latencyMs !== undefined
          ? React.createElement(Text, { color: 'gray' }, ` ${node.latencyMs}ms`)
          : null
      )
    );

    // Error line
    if (node.error) {
      nodeElements.push(
        React.createElement(
          Box,
          { key: 'error', marginLeft: depth * 2 + 4 },
          React.createElement(Text, { color: 'red' }, `Error: ${node.error}`)
        )
      );
    }

    // Content sections (only if selected and content exists)
    if (isSelected && node.content) {
      const c = node.content;
      if (c.raw) nodeElements.push(renderContentSnapshot(CONTENT_LABELS.raw!, c.raw));
      if (c.transformed)
        nodeElements.push(renderContentSnapshot(CONTENT_LABELS.transformed!, c.transformed));
      if (c.encoded) nodeElements.push(renderContentSnapshot(CONTENT_LABELS.encoded!, c.encoded));
      if (c.sent) nodeElements.push(renderContentSnapshot(CONTENT_LABELS.sent!, c.sent));
      if (c.response)
        nodeElements.push(renderContentSnapshot(CONTENT_LABELS.response!, c.response));
      if (c.processingError) {
        nodeElements.push(
          React.createElement(
            Box,
            { key: 'procError', marginLeft: 2 },
            React.createElement(Text, { color: 'red' }, `Processing Error: ${c.processingError}`)
          )
        );
      }
    }

    return React.createElement(
      Box,
      { key: flatNode.key, flexDirection: 'column' },
      ...nodeElements
    );
  };

  // Summary bar
  const summaryParts = [
    `${traceData.totalNodes} node${traceData.totalNodes !== 1 ? 's' : ''}`,
    `depth ${traceData.maxDepth}`,
  ];
  if (traceData.totalLatencyMs > 0) {
    summaryParts.push(`${traceData.totalLatencyMs}ms total`);
  }
  if (traceData.hasErrors) {
    summaryParts.push('HAS ERRORS');
  }
  if (traceData.truncated) {
    summaryParts.push('TRUNCATED');
  }

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: traceData.hasErrors ? 'red' : 'cyan',
      paddingX: 1,
      paddingY: 0,
      width: boxWidth,
    },
    // Header
    React.createElement(
      Box,
      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 0 },
      React.createElement(
        Text,
        { bold: true, color: 'cyan' },
        `Trace: ${traceData.root.channelName} \u2192 Message #${traceData.root.messageId}`
      ),
      React.createElement(Text, { color: 'gray' }, '[Escape] Close')
    ),
    // Summary
    React.createElement(
      Box,
      { marginBottom: 0 },
      React.createElement(Text, { color: 'gray' }, summaryParts.join(' | ')),
      React.createElement(Text, { color: 'gray' }, verbose ? '  [verbose]' : '')
    ),
    // Divider
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: 'gray' }, '\u2500'.repeat(boxWidth - 4))
    ),
    // Tree nodes
    ...visibleNodes.map((flatNode, index) => renderNode(flatNode, index)),
    // Scroll indicator
    flatNodes.length > visibleRows
      ? React.createElement(
          Box,
          { marginTop: 0 },
          React.createElement(
            Text,
            { color: 'gray' },
            `[${scrollOffset + 1}-${Math.min(scrollOffset + visibleRows, flatNodes.length)} of ${flatNodes.length}]`
          )
        )
      : null,
    // Footer
    React.createElement(
      Box,
      { marginTop: 0 },
      React.createElement(
        Text,
        { color: 'gray' },
        '[\u2191\u2193/jk] Navigate  [Enter/Space] Expand  [v] Verbose  [Escape] Close'
      )
    )
  );
};

export default TraceTreeView;
