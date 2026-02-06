/**
 * MessageList Component
 *
 * Scrollable message table overlay for browsing channel messages.
 * Follows the overlay pattern from TraceTreeView.tsx.
 */

import React, { FC, useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Message, MessageStatus, ConnectorMessage } from '../../types/index.js';

export interface MessageListProps {
  messages: Message[];
  totalCount: number;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  statusFilter: MessageStatus | null;
  channelName: string;

  onClose: () => void;
  onSelectMessage: (message: Message) => void;
  onTrace: (channelId: string, messageId: number) => void;
  onCycleFilter: () => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  onRefresh: () => void;
}

/** Status code to display label */
const STATUS_LABELS: Record<MessageStatus, string> = {
  R: 'RECEIVED',
  F: 'FILTERED',
  T: 'TRANSFORMED',
  S: 'SENT',
  Q: 'QUEUED',
  E: 'ERROR',
  P: 'PENDING',
};

/** Status code to color */
const STATUS_COLORS: Record<MessageStatus, string> = {
  R: 'green',
  F: 'yellow',
  T: 'green',
  S: 'green',
  Q: 'yellow',
  E: 'red',
  P: 'gray',
};

/** Status code to symbol */
const STATUS_SYMBOLS: Record<MessageStatus, string> = {
  R: '\u25CF', // ●
  F: '\u25CB', // ○
  T: '\u25CF', // ●
  S: '\u25CF', // ●
  Q: '\u25D0', // ◐
  E: '\u2718', // ✘
  P: '\u25D4', // ◔
};

/**
 * Format a date string for display.
 * Exported for testing.
 */
export function formatDate(dateStr: string): string {
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

/**
 * Get display label for a filter status (null means "All").
 * Exported for testing.
 */
export function getFilterLabel(status: MessageStatus | null): string {
  if (status === null) return 'All';
  return STATUS_LABELS[status] ?? status;
}

/**
 * Get a summary of connector names for a message.
 * Exported for testing.
 */
export function getConnectorSummary(connectorMessages: Record<number, ConnectorMessage>): string {
  const entries = Object.values(connectorMessages);
  if (entries.length === 0) return '-';
  return entries
    .sort((a, b) => a.metaDataId - b.metaDataId)
    .map((c) => c.connectorName)
    .join(', ');
}

/**
 * Get the overall status of a message from its connector messages.
 * Uses metaDataId 0 (source) status, falling back to first connector.
 */
function getMessageStatus(msg: Message): MessageStatus {
  const source = msg.connectorMessages[0];
  if (source) return source.status;
  const first = Object.values(msg.connectorMessages)[0];
  return first?.status ?? 'R';
}

/**
 * MessageList component
 */
export const MessageList: FC<MessageListProps> = ({
  messages,
  totalCount,
  loading,
  error,
  page,
  pageSize,
  statusFilter,
  channelName,
  onClose,
  onSelectMessage,
  onTrace,
  onCycleFilter,
  onNextPage,
  onPrevPage,
  onRefresh,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const termHeight = process.stdout.rows || 24;
  const visibleRows = Math.max(5, termHeight - 9);

  const [scrollOffset, setScrollOffset] = useState(0);

  // Clamp selected index when messages change
  const clampedIndex = useMemo(
    () => Math.min(selectedIndex, Math.max(0, messages.length - 1)),
    [selectedIndex, messages.length]
  );

  const totalPageCount = totalCount <= 0 ? 1 : Math.ceil(totalCount / pageSize);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    // Navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => {
        const next = Math.max(0, prev - 1);
        if (next < scrollOffset) setScrollOffset(next);
        return next;
      });
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => {
        const next = Math.min(messages.length - 1, prev + 1);
        if (next >= scrollOffset + visibleRows) setScrollOffset(next - visibleRows + 1);
        return next;
      });
      return;
    }

    // Select message
    if (key.return) {
      const msg = messages[clampedIndex];
      if (msg) onSelectMessage(msg);
      return;
    }

    // Trace
    if (input === 'x' || input === 'X') {
      const msg = messages[clampedIndex];
      if (msg) onTrace(msg.channelId, msg.messageId);
      return;
    }

    // Filter
    if (input === 'f' || input === 'F') {
      setSelectedIndex(0);
      setScrollOffset(0);
      onCycleFilter();
      return;
    }

    // Next page
    if (input === 'n' || input === 'N') {
      setSelectedIndex(0);
      setScrollOffset(0);
      onNextPage();
      return;
    }

    // Previous page
    if (input === 'b' || input === 'B') {
      setSelectedIndex(0);
      setScrollOffset(0);
      onPrevPage();
      return;
    }

    // Refresh
    if (input === 'r' || input === 'R') {
      onRefresh();
      return;
    }
  });

  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(90, termWidth - 2);

  const visibleMessages = messages.slice(scrollOffset, scrollOffset + visibleRows);

  const renderRow = (msg: Message, index: number) => {
    const isSelected = index + scrollOffset === clampedIndex;
    const status = getMessageStatus(msg);
    const color = STATUS_COLORS[status] ?? 'gray';
    const symbol = STATUS_SYMBOLS[status] ?? '?';
    const label = STATUS_LABELS[status] ?? status;
    const date = formatDate(msg.receivedDate);
    const connectors = getConnectorSummary(msg.connectorMessages);
    const pointer = isSelected ? '\u25B8 ' : '  ';

    return React.createElement(
      Box,
      { key: msg.messageId, flexDirection: 'row' },
      React.createElement(Text, { color: isSelected ? 'cyan' : 'white' }, pointer),
      React.createElement(
        Text,
        { bold: isSelected, color: isSelected ? 'cyan' : 'white' },
        String(msg.messageId).padStart(6)
      ),
      React.createElement(Text, null, '  '),
      React.createElement(Text, { color }, `${symbol} ${label.padEnd(12)}`),
      React.createElement(Text, { color: 'gray' }, `  ${date}`),
      React.createElement(Text, { color: 'gray' }, `  ${connectors}`)
    );
  };

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'cyan',
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
        `Messages: ${channelName}`
      ),
      React.createElement(Text, { color: 'gray' }, '[Esc] Back')
    ),
    // Filter and page info
    React.createElement(
      Box,
      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 0 },
      React.createElement(
        Text,
        { color: 'gray' },
        `Filter: ${getFilterLabel(statusFilter)} (${totalCount} total)`
      ),
      React.createElement(
        Text,
        { color: 'gray' },
        `Page ${page + 1} of ${totalPageCount}`
      )
    ),
    // Divider
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: 'gray' }, '\u2500'.repeat(boxWidth - 4))
    ),
    // Column headers
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: 'gray', bold: true }, '  '),
      React.createElement(Text, { color: 'gray', bold: true }, '    ID'),
      React.createElement(Text, { color: 'gray', bold: true }, '  '),
      React.createElement(Text, { color: 'gray', bold: true }, 'STATUS      '),
      React.createElement(Text, { color: 'gray', bold: true }, '  RECEIVED           '),
      React.createElement(Text, { color: 'gray', bold: true }, '  CONNECTORS')
    ),
    // Loading state
    loading &&
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: 'cyan' }, 'Loading messages...')
      ),
    // Error state
    error &&
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: 'red' }, `Error: ${error}`)
      ),
    // Empty state
    !loading && !error && messages.length === 0 &&
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: 'gray' }, 'No messages found.')
      ),
    // Message rows
    ...visibleMessages.map((msg, idx) => renderRow(msg, idx)),
    // Scroll indicator
    messages.length > visibleRows
      ? React.createElement(
          Box,
          { marginTop: 0 },
          React.createElement(
            Text,
            { color: 'gray' },
            `[${scrollOffset + 1}-${Math.min(scrollOffset + visibleRows, messages.length)} of ${messages.length}]`
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
        '[\u2191\u2193] Nav  [Enter] View  [X] Trace  [F] Filter  [N\u00B7B] Page  [R] Refresh  [Esc] Back'
      )
    )
  );
};

export default MessageList;
