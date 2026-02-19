/**
 * MessageDetail Component
 *
 * Single message detail overlay with Overview and Content tabs.
 * Shows connector statuses, pipeline content at each stage,
 * and provides trace shortcut.
 */

import React, { FC, useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Message, ConnectorMessage, MessageStatus } from '../../types/index.js';

export interface MessageDetailProps {
  /** Basic message data (already loaded from list) */
  message: Message;
  /** Channel display name */
  channelName: string;
  /** Full message with content (loaded async) */
  fullMessage: Message | null;
  /** Whether full message content is loading */
  loading: boolean;
  /** Error from content loading */
  error: string | null;
  /** Navigate back to message list */
  onClose: () => void;
  /** Launch trace for this message */
  onTrace: (channelId: string, messageId: number) => void;
}

type DetailTab = 'overview' | 'content';

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

/** Status colors */
const STATUS_COLORS: Record<MessageStatus, string> = {
  R: 'green',
  F: 'yellow',
  T: 'green',
  S: 'green',
  Q: 'yellow',
  E: 'red',
  P: 'gray',
};

/** Content type numeric IDs to readable labels */
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

/**
 * Get the label for a content type (by string name or numeric key).
 * Exported for testing.
 */
export function getContentTypeLabel(key: number | string): string {
  if (typeof key === 'number') {
    return CONTENT_TYPE_LABELS[key] ?? `TYPE_${key}`;
  }
  return String(key);
}

/**
 * Sort connector messages by metaDataId.
 * Exported for testing.
 */
export function sortConnectors(
  connectorMessages: Record<number, ConnectorMessage>
): ConnectorMessage[] {
  return Object.values(connectorMessages).sort((a, b) => a.metaDataId - b.metaDataId);
}

/**
 * Truncate content for display (default 500 chars).
 * Exported for testing.
 */
export function truncateContent(text: string, maxLength: number = 500): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Format a date string for display.
 */
function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString();
  } catch {
    return dateStr;
  }
}

/**
 * MessageDetail component
 */
export const MessageDetail: FC<MessageDetailProps> = ({
  message,
  channelName,
  fullMessage,
  loading,
  error,
  onClose,
  onTrace,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [selectedConnectorIndex, setSelectedConnectorIndex] = useState(0);

  const connectors = useMemo(() => sortConnectors(message.connectorMessages), [message]);

  // Get connectors from fullMessage if available (has content)
  const fullConnectors = useMemo(
    () => (fullMessage ? sortConnectors(fullMessage.connectorMessages) : []),
    [fullMessage]
  );

  const clampedConnectorIndex = Math.min(
    selectedConnectorIndex,
    Math.max(0, connectors.length - 1)
  );

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    // Tab switching
    if (key.tab) {
      setActiveTab((prev) => (prev === 'overview' ? 'content' : 'overview'));
      return;
    }

    // Navigation (connector selection in content tab)
    if (activeTab === 'content') {
      if (key.upArrow || input === 'k') {
        setSelectedConnectorIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSelectedConnectorIndex((prev) => Math.min(connectors.length - 1, prev + 1));
        return;
      }
    }

    // Trace
    if (input === 'x' || input === 'X') {
      onTrace(message.channelId, message.messageId);
      return;
    }
  });

  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(80, termWidth - 2);

  const renderTabButton = (tab: DetailTab, label: string) =>
    React.createElement(
      Text,
      {
        color: activeTab === tab ? 'cyan' : 'gray',
        inverse: activeTab === tab,
      },
      ` ${label} `
    );

  const renderOverviewTab = () => {
    const elements: React.ReactElement[] = [];

    // Message info
    elements.push(
      React.createElement(
        Box,
        { key: 'id', flexDirection: 'row' },
        React.createElement(Text, { color: 'gray' }, 'Message ID:  '),
        React.createElement(Text, { bold: true }, String(message.messageId))
      )
    );
    elements.push(
      React.createElement(
        Box,
        { key: 'channel', flexDirection: 'row' },
        React.createElement(Text, { color: 'gray' }, 'Channel:     '),
        React.createElement(Text, null, channelName)
      )
    );
    elements.push(
      React.createElement(
        Box,
        { key: 'received', flexDirection: 'row' },
        React.createElement(Text, { color: 'gray' }, 'Received:    '),
        React.createElement(Text, null, formatDate(message.receivedDate))
      )
    );
    elements.push(
      React.createElement(
        Box,
        { key: 'processed', flexDirection: 'row' },
        React.createElement(Text, { color: 'gray' }, 'Processed:   '),
        React.createElement(Text, null, message.processed ? 'Yes' : 'No')
      )
    );

    // Connector table
    elements.push(
      React.createElement(
        Box,
        { key: 'conn-header', marginTop: 1 },
        React.createElement(Text, { bold: true, color: 'gray' }, 'Connectors')
      )
    );
    elements.push(
      React.createElement(
        Box,
        { key: 'conn-divider' },
        React.createElement(Text, { color: 'gray' }, '\u2500'.repeat(60))
      )
    );
    elements.push(
      React.createElement(
        Box,
        { key: 'conn-cols', flexDirection: 'row' },
        React.createElement(Text, { color: 'gray', bold: true }, 'ID'.padEnd(5)),
        React.createElement(Text, { color: 'gray', bold: true }, 'Name'.padEnd(20)),
        React.createElement(Text, { color: 'gray', bold: true }, 'Status'.padEnd(14)),
        React.createElement(Text, { color: 'gray', bold: true }, 'Attempts')
      )
    );

    for (const conn of connectors) {
      const status = STATUS_LABELS[conn.status] ?? conn.status;
      const statusColor = STATUS_COLORS[conn.status] ?? 'gray';
      elements.push(
        React.createElement(
          Box,
          { key: `conn-${conn.metaDataId}`, flexDirection: 'row' },
          React.createElement(Text, null, String(conn.metaDataId).padEnd(5)),
          React.createElement(Text, null, conn.connectorName.padEnd(20)),
          React.createElement(Text, { color: statusColor }, status.padEnd(14)),
          React.createElement(Text, null, String(conn.sendAttempts))
        )
      );
    }

    return React.createElement(Box, { flexDirection: 'column', marginTop: 1 }, ...elements);
  };

  const renderContentTab = () => {
    if (loading) {
      return React.createElement(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        React.createElement(Text, { color: 'cyan' }, 'Loading content...')
      );
    }

    if (error) {
      return React.createElement(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        React.createElement(Text, { color: 'red' }, `Error: ${error}`)
      );
    }

    if (fullConnectors.length === 0) {
      return React.createElement(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        React.createElement(Text, { color: 'gray' }, 'No content available.')
      );
    }

    const elements: React.ReactElement[] = [];

    // Connector selector
    elements.push(
      React.createElement(
        Box,
        { key: 'selector-label', marginBottom: 0 },
        React.createElement(Text, { color: 'gray', bold: true }, 'Select connector [\u2191\u2193]:')
      )
    );

    for (let i = 0; i < fullConnectors.length; i++) {
      const conn = fullConnectors[i]!;
      const isSelected = i === clampedConnectorIndex;
      const pointer = isSelected ? '\u25B8 ' : '  ';
      const statusColor = STATUS_COLORS[conn.status] ?? 'gray';
      elements.push(
        React.createElement(
          Box,
          { key: `sel-${conn.metaDataId}`, flexDirection: 'row' },
          React.createElement(Text, { color: isSelected ? 'cyan' : 'white' }, pointer),
          React.createElement(
            Text,
            { bold: isSelected, color: isSelected ? 'cyan' : 'white' },
            `[${conn.metaDataId}] ${conn.connectorName}`
          ),
          React.createElement(
            Text,
            { color: statusColor },
            ` ${STATUS_LABELS[conn.status] ?? conn.status}`
          )
        )
      );
    }

    // Show content for selected connector
    const selected = fullConnectors[clampedConnectorIndex];
    if (selected?.content) {
      elements.push(
        React.createElement(
          Box,
          { key: 'content-divider', marginTop: 1 },
          React.createElement(Text, { color: 'gray' }, '\u2500'.repeat(50))
        )
      );

      const contentEntries = Object.entries(selected.content);
      if (contentEntries.length === 0) {
        elements.push(
          React.createElement(
            Box,
            { key: 'no-content' },
            React.createElement(Text, { color: 'gray' }, 'No content for this connector.')
          )
        );
      } else {
        for (const [typeKey, mc] of contentEntries) {
          const content = mc;
          const label = getContentTypeLabel(Number(typeKey) || typeKey);
          elements.push(
            React.createElement(
              Box,
              { key: `ct-${typeKey}`, flexDirection: 'column', marginTop: 1 },
              React.createElement(
                Box,
                { flexDirection: 'row' },
                React.createElement(Text, { color: 'cyan', bold: true }, `${label}:`),
                React.createElement(Text, { color: 'gray' }, ` (${content.dataType})`)
              ),
              React.createElement(Text, { color: 'white' }, truncateContent(content.content))
            )
          );
        }
      }
    } else if (selected) {
      elements.push(
        React.createElement(
          Box,
          { key: 'no-sel-content', marginTop: 1 },
          React.createElement(Text, { color: 'gray' }, 'No content available for this connector.')
        )
      );
    }

    return React.createElement(Box, { flexDirection: 'column', marginTop: 1 }, ...elements);
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
        `Message #${message.messageId} \u2014 ${channelName}`
      ),
      React.createElement(Text, { color: 'gray' }, '[Esc] Back')
    ),
    // Tabs
    React.createElement(
      Box,
      { flexDirection: 'row', marginBottom: 0 },
      renderTabButton('overview', 'Overview'),
      React.createElement(Text, null, ' '),
      renderTabButton('content', 'Content')
    ),
    // Divider
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: 'gray' }, '\u2500'.repeat(boxWidth - 4))
    ),
    // Tab content
    activeTab === 'overview' ? renderOverviewTab() : renderContentTab(),
    // Footer
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { color: 'gray' },
        '[Tab] Switch Tab  [\u2191\u2193] Navigate  [X] Trace  [Esc] Back'
      )
    )
  );
};

export default MessageDetail;
