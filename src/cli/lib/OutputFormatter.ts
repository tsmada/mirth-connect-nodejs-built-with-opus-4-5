/**
 * Output Formatter
 *
 * Provides consistent output formatting for CLI commands.
 * Supports both table and JSON output formats.
 */

import chalk, { ChalkInstance } from 'chalk';
import {
  ChannelStatus,
  ChannelState,
  Message,
  MessageStatus,
  ServerEvent,
  EventLevel,
  SystemInfo,
  SystemStats,
} from '../types/index.js';

// =============================================================================
// Color Helpers
// =============================================================================

// Type alias for chalk function return type
type ChalkFn = ChalkInstance;

/**
 * Get color for channel state
 */
export function getStateColor(state: ChannelState): ChalkFn {
  switch (state) {
    case 'STARTED':
      return chalk.green;
    case 'STOPPED':
      return chalk.red;
    case 'PAUSED':
      return chalk.yellow;
    case 'STARTING':
    case 'STOPPING':
    case 'PAUSING':
      return chalk.cyan;
    case 'UNDEPLOYED':
      return chalk.gray;
    default:
      return chalk.white;
  }
}

/**
 * Get color for message status
 */
export function getMessageStatusColor(status: MessageStatus): ChalkFn {
  switch (status) {
    case 'S': // SENT
      return chalk.green;
    case 'E': // ERROR
      return chalk.red;
    case 'F': // FILTERED
      return chalk.yellow;
    case 'Q': // QUEUED
      return chalk.cyan;
    case 'R': // RECEIVED
    case 'T': // TRANSFORMED
    case 'P': // PENDING
    default:
      return chalk.white;
  }
}

/**
 * Get color for event level
 */
export function getEventLevelColor(level: EventLevel): ChalkFn {
  switch (level) {
    case 'ERROR':
      return chalk.red;
    case 'WARNING':
      return chalk.yellow;
    case 'INFORMATION':
    default:
      return chalk.white;
  }
}

// =============================================================================
// Format Helpers
// =============================================================================

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format number with commas
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format date to local string
 */
export function formatDate(date: string | Date | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Truncate string to max length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Pad string to fixed width
 */
export function pad(str: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (str.length >= width) return str.slice(0, width);
  const padding = ' '.repeat(width - str.length);
  return align === 'left' ? str + padding : padding + str;
}

// =============================================================================
// Table Formatting
// =============================================================================

interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

interface TableOptions {
  columns: TableColumn[];
  border?: boolean;
}

/**
 * Create a simple ASCII table
 */
export function createTable(data: string[][], options: TableOptions): string {
  const { columns, border = true } = options;
  const lines: string[] = [];

  // Calculate actual widths (header or column width, whichever is larger)
  const widths = columns.map((col, i) => {
    const maxDataWidth = Math.max(...data.map((row) => (row[i] || '').length));
    return Math.max(col.width, col.header.length, maxDataWidth);
  });

  // Border characters
  const h = border ? '─' : '';
  const v = border ? '│' : '';
  const tl = border ? '┌' : '';
  const tr = border ? '┐' : '';
  const bl = border ? '└' : '';
  const br = border ? '┘' : '';
  const ml = border ? '├' : '';
  const mr = border ? '┤' : '';
  const t = border ? '┬' : '';
  const b = border ? '┴' : '';
  const c = border ? '┼' : '';

  // Top border
  if (border) {
    lines.push(tl + widths.map((w) => h.repeat(w + 2)).join(t) + tr);
  }

  // Header
  const headerRow = columns
    .map((col, i) => pad(col.header, widths[i]!, col.align))
    .map((cell) => (border ? ` ${cell} ` : cell))
    .join(v);
  lines.push(border ? v + headerRow + v : headerRow);

  // Header separator
  if (border) {
    lines.push(ml + widths.map((w) => h.repeat(w + 2)).join(c) + mr);
  } else {
    lines.push(widths.map((w) => '-'.repeat(w)).join(' '));
  }

  // Data rows
  for (const row of data) {
    const dataRow = columns
      .map((col, i) => pad(row[i] || '', widths[i]!, col.align))
      .map((cell) => (border ? ` ${cell} ` : cell))
      .join(v);
    lines.push(border ? v + dataRow + v : dataRow);
  }

  // Bottom border
  if (border) {
    lines.push(bl + widths.map((w) => h.repeat(w + 2)).join(b) + br);
  }

  return lines.join('\n');
}

// =============================================================================
// Specific Formatters
// =============================================================================

/**
 * Format channel statuses as a table
 */
export function formatChannelStatusTable(statuses: ChannelStatus[]): string {
  const columns: TableColumn[] = [
    { header: 'ID', width: 36 },
    { header: 'NAME', width: 24 },
    { header: 'STATUS', width: 10 },
    { header: 'RECV', width: 6, align: 'right' },
    { header: 'SENT', width: 6, align: 'right' },
    { header: 'ERR', width: 5, align: 'right' },
  ];

  const data = statuses.map((status) => {
    const stateColor = getStateColor(status.state);
    return [
      status.channelId,
      truncate(status.name, 24),
      stateColor(status.state),
      formatNumber(status.statistics?.received || 0),
      formatNumber(status.statistics?.sent || 0),
      status.statistics?.errored
        ? chalk.red(formatNumber(status.statistics.errored))
        : '0',
    ];
  });

  return createTable(data, { columns });
}

/**
 * Format messages as a table
 */
export function formatMessageTable(messages: Message[]): string {
  const columns: TableColumn[] = [
    { header: 'ID', width: 10, align: 'right' },
    { header: 'RECEIVED', width: 20 },
    { header: 'STATUS', width: 8 },
    { header: 'CONNECTOR', width: 20 },
  ];

  const data = messages.map((msg) => {
    // Get the source connector (metaDataId 0)
    const sourceConnector = msg.connectorMessages[0];
    const status = sourceConnector?.status || 'R';
    const statusColor = getMessageStatusColor(status as MessageStatus);

    return [
      String(msg.messageId),
      formatDate(msg.receivedDate),
      statusColor(status),
      sourceConnector?.connectorName || '-',
    ];
  });

  return createTable(data, { columns });
}

/**
 * Format events as a table
 */
export function formatEventTable(events: ServerEvent[]): string {
  const columns: TableColumn[] = [
    { header: 'ID', width: 8, align: 'right' },
    { header: 'DATE/TIME', width: 20 },
    { header: 'LEVEL', width: 12 },
    { header: 'NAME', width: 30 },
    { header: 'OUTCOME', width: 8 },
  ];

  const data = events.map((event) => {
    const levelColor = getEventLevelColor(event.level);
    return [
      String(event.id),
      formatDate(event.dateTime),
      levelColor(event.level),
      truncate(event.name, 30),
      event.outcome === 'SUCCESS' ? chalk.green('SUCCESS') : chalk.red('FAILURE'),
    ];
  });

  return createTable(data, { columns });
}

/**
 * Format system info
 */
export function formatSystemInfo(info: SystemInfo): string {
  const lines = [
    chalk.bold('System Information'),
    '',
    `  ${chalk.gray('Runtime:')}    ${info.jvmVersion}`,
    `  ${chalk.gray('OS:')}         ${info.osName} ${info.osVersion} (${info.osArchitecture})`,
    `  ${chalk.gray('Database:')}   ${info.dbName} ${info.dbVersion}`,
  ];
  return lines.join('\n');
}

/**
 * Format system stats
 */
export function formatSystemStats(stats: SystemStats): string {
  const lines = [
    chalk.bold('System Statistics'),
    '',
    `  ${chalk.gray('CPU Usage:')}       ${stats.cpuUsagePercent.toFixed(1)}%`,
    `  ${chalk.gray('Memory Used:')}     ${formatBytes(stats.allocatedMemoryBytes - stats.freeMemoryBytes)}`,
    `  ${chalk.gray('Memory Free:')}     ${formatBytes(stats.freeMemoryBytes)}`,
    `  ${chalk.gray('Memory Max:')}      ${formatBytes(stats.maxMemoryBytes)}`,
    `  ${chalk.gray('Disk Free:')}       ${formatBytes(stats.diskFreeBytes)}`,
    `  ${chalk.gray('Disk Total:')}      ${formatBytes(stats.diskTotalBytes)}`,
    '',
    chalk.gray(`  Updated: ${formatDate(stats.timestamp)}`),
  ];
  return lines.join('\n');
}

/**
 * Format channel details
 */
export function formatChannelDetails(status: ChannelStatus): string {
  const stateColor = getStateColor(status.state);
  const lines = [
    chalk.bold(`Channel: ${status.name}`),
    '',
    `  ${chalk.gray('ID:')}         ${status.channelId}`,
    `  ${chalk.gray('Status:')}     ${stateColor(status.state)}`,
    `  ${chalk.gray('Deployed:')}   ${status.deployedDate ? formatDate(status.deployedDate) : '-'}`,
    '',
    chalk.bold('Statistics:'),
    `  ${chalk.gray('Received:')}   ${formatNumber(status.statistics?.received || 0)}`,
    `  ${chalk.gray('Filtered:')}   ${formatNumber(status.statistics?.filtered || 0)}`,
    `  ${chalk.gray('Queued:')}     ${formatNumber(status.statistics?.queued || 0)}`,
    `  ${chalk.gray('Sent:')}       ${formatNumber(status.statistics?.sent || 0)}`,
    `  ${chalk.gray('Errored:')}    ${status.statistics?.errored ? chalk.red(formatNumber(status.statistics.errored)) : '0'}`,
  ];

  // Add connector statuses if available
  if (status.childStatuses && status.childStatuses.length > 0) {
    lines.push('', chalk.bold('Connectors:'));
    for (const connector of status.childStatuses) {
      const connectorStateColor = getStateColor(connector.state);
      lines.push(
        `  ${chalk.cyan(connector.name)} (${connector.metaDataId}): ${connectorStateColor(connector.state)}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Format message details
 */
export function formatMessageDetails(message: Message): string {
  const lines = [
    chalk.bold(`Message ID: ${message.messageId}`),
    '',
    `  ${chalk.gray('Channel ID:')}   ${message.channelId}`,
    `  ${chalk.gray('Server ID:')}    ${message.serverId}`,
    `  ${chalk.gray('Received:')}     ${formatDate(message.receivedDate)}`,
    `  ${chalk.gray('Processed:')}    ${message.processed ? chalk.green('Yes') : chalk.yellow('No')}`,
  ];

  if (message.originalId) {
    lines.push(`  ${chalk.gray('Original ID:')}  ${message.originalId}`);
  }

  // Add connector messages
  lines.push('', chalk.bold('Connector Messages:'));
  for (const [metaDataId, connector] of Object.entries(message.connectorMessages)) {
    const statusColor = getMessageStatusColor(connector.status);
    lines.push(
      '',
      `  ${chalk.cyan(connector.connectorName)} (${metaDataId}):`,
      `    ${chalk.gray('Status:')}        ${statusColor(connector.status)}`,
      `    ${chalk.gray('Received:')}      ${formatDate(connector.receivedDate)}`,
      `    ${chalk.gray('Send Attempts:')} ${connector.sendAttempts}`
    );
    if (connector.sendDate) {
      lines.push(`    ${chalk.gray('Sent:')}          ${formatDate(connector.sendDate)}`);
    }
    if (connector.errorCode !== undefined && connector.errorCode !== 0) {
      lines.push(`    ${chalk.gray('Error Code:')}    ${chalk.red(String(connector.errorCode))}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// JSON Formatting
// =============================================================================

/**
 * Format any data as pretty JSON
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// =============================================================================
// Output Helper
// =============================================================================

/**
 * OutputFormatter class for consistent output handling
 */
export class OutputFormatter {
  private jsonMode: boolean;

  constructor(jsonMode: boolean = false) {
    this.jsonMode = jsonMode;
  }

  /**
   * Output data (table or JSON based on mode)
   */
  output(tableOutput: string, jsonData: unknown): void {
    if (this.jsonMode) {
      console.log(formatJson(jsonData));
    } else {
      console.log(tableOutput);
    }
  }

  /**
   * Output success message
   */
  success(message: string): void {
    if (this.jsonMode) {
      console.log(formatJson({ success: true, message }));
    } else {
      console.log(chalk.green('✔') + ' ' + message);
    }
  }

  /**
   * Output error message
   */
  error(message: string, details?: unknown): void {
    if (this.jsonMode) {
      console.log(formatJson({ success: false, error: message, details }));
    } else {
      console.error(chalk.red('✖') + ' ' + message);
      if (details) {
        console.error(chalk.gray(JSON.stringify(details, null, 2)));
      }
    }
  }

  /**
   * Output warning message
   */
  warn(message: string): void {
    if (this.jsonMode) {
      console.log(formatJson({ warning: message }));
    } else {
      console.log(chalk.yellow('⚠') + ' ' + message);
    }
  }

  /**
   * Output info message
   */
  info(message: string): void {
    if (!this.jsonMode) {
      console.log(chalk.blue('ℹ') + ' ' + message);
    }
  }
}

export default OutputFormatter;
