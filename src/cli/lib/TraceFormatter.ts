/**
 * Trace Tree Formatter
 *
 * Renders a TraceResult as a colorized tree in the terminal.
 *
 * Output format:
 *
 *   Message Trace: ADT Receiver -> HL7 Router -> EMR Writer, Audit Log
 *   Hops: 4 | Depth: 3 | Latency: 456ms | Errors: 1
 *
 *   ● [SENT] ADT Receiver (msg #123)  14:30:45.123
 *   │  RAW: MSH|^~\&|EPIC|... (2,450 chars)
 *   │
 *   ├──► [SENT] HL7 Router (msg #456)  +111ms
 *   │    │  RAW: MSH|^~\&|MIRTH|... (2,890 chars)
 *   │    │
 *   │    └──► [SENT] EMR Writer (msg #789)  +222ms
 *   │
 *   └──► [ERROR] Audit Log (msg #101)  +177ms
 *        ERROR: Connection refused: localhost:5432
 */

import chalk from 'chalk';
import { TraceResult, TraceNode, ContentSnapshot } from '../types/index.js';

export interface FormatOptions {
  /** Show content previews (false = tree structure only) */
  showContent: boolean;
  /** Max content preview length (default 200, verbose 2000) */
  maxPreviewLength: number;
}

const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  showContent: true,
  maxPreviewLength: 200,
};

/**
 * Format the complete trace result for terminal output
 */
export function formatTraceTree(result: TraceResult, userOptions?: Partial<FormatOptions>): string {
  const options: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...userOptions };
  const lines: string[] = [];

  // Summary header
  lines.push(formatSummary(result));
  lines.push('');

  // Tree
  const treeLines = formatNode(result.root, '', true, options);
  lines.push(...treeLines);

  if (result.truncated) {
    lines.push('');
    lines.push(chalk.yellow('  ... (trace truncated, increase --max-depth or --max-children)'));
  }

  return lines.join('\n');
}

/**
 * Format summary header line
 */
function formatSummary(result: TraceResult): string {
  // Build channel path
  const path = collectPathNames(result.root);
  const pathStr = path.join(chalk.gray(' -> '));

  const parts: string[] = [];
  parts.push(`Hops: ${chalk.bold(String(result.totalNodes))}`);
  parts.push(`Depth: ${chalk.bold(String(result.maxDepth))}`);
  parts.push(`Latency: ${chalk.bold(result.totalLatencyMs + 'ms')}`);

  if (result.hasErrors) {
    const errorCount = countErrors(result.root);
    parts.push(`Errors: ${chalk.red.bold(String(errorCount))}`);
  }

  return [`${chalk.bold('Message Trace:')} ${pathStr}`, chalk.gray(parts.join(' | '))].join('\n');
}

/**
 * Collect channel names along the main path (leftmost child at each level)
 */
function collectPathNames(node: TraceNode): string[] {
  const names: string[] = [chalk.cyan(node.channelName)];

  if (node.children.length === 0) return names;

  if (node.children.length === 1) {
    names.push(...collectPathNames(node.children[0]!));
  } else {
    // Multiple children — show them comma-separated
    const childNames = node.children.map((c) => chalk.cyan(c.channelName));
    names.push(childNames.join(', '));
  }

  return names;
}

/**
 * Count errors in the tree
 */
function countErrors(node: TraceNode): number {
  let count = node.status === 'ERROR' || node.error ? 1 : 0;
  for (const child of node.children) {
    count += countErrors(child);
  }
  return count;
}

/**
 * Format a single node and its children recursively
 */
function formatNode(
  node: TraceNode,
  prefix: string,
  isLast: boolean,
  options: FormatOptions
): string[] {
  const lines: string[] = [];

  // Node line: connector symbol + status + channel name + message ID + timing
  const isRoot = node.depth === 0;
  const connector = isRoot ? '' : isLast ? '└──► ' : '├──► ';
  const statusIcon = getStatusIcon(node.status);
  const statusBadge = formatStatus(node.status);
  const channelName = chalk.cyan.bold(node.channelName);
  const msgId = chalk.gray(`(msg #${node.messageId})`);

  let timing = '';
  if (isRoot && node.receivedDate) {
    const date = new Date(node.receivedDate);
    timing = chalk.gray(`  ${formatTime(date)}`);
  } else if (node.latencyMs !== undefined) {
    timing = chalk.gray(`  +${node.latencyMs}ms`);
  }

  const destLabel = node.parentDestinationName
    ? chalk.gray(` via ${node.parentDestinationName}`)
    : '';

  const nodeLine = `${prefix}${connector}${statusIcon} ${statusBadge} ${channelName} ${msgId}${destLabel}${timing}`;
  lines.push(nodeLine);

  // Content lines
  const childPrefix = isRoot ? '' : prefix + (isLast ? '     ' : '│    ');

  if (options.showContent && node.content) {
    const contentLines = formatNodeContent(node.content, childPrefix, options.maxPreviewLength);
    lines.push(...contentLines);
  }

  if (node.error && !node.content?.processingError) {
    lines.push(`${childPrefix}${chalk.red('ERROR:')} ${node.error}`);
  }

  // Children
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    const childIsLast = i === node.children.length - 1;

    // Add spacing between siblings
    if (i === 0 && options.showContent && node.content) {
      lines.push(`${childPrefix}│`);
    }

    const childLines = formatNode(child, childPrefix, childIsLast, options);
    lines.push(...childLines);
  }

  return lines;
}

/**
 * Format content previews for a node
 */
function formatNodeContent(
  content: {
    raw?: ContentSnapshot;
    transformed?: ContentSnapshot;
    encoded?: ContentSnapshot;
    sent?: ContentSnapshot;
    response?: ContentSnapshot;
    processingError?: string;
  },
  prefix: string,
  maxLength: number
): string[] {
  const lines: string[] = [];

  if (content.raw) {
    lines.push(formatContentLine(content.raw, 'RAW', prefix, maxLength));
  }
  if (content.transformed) {
    lines.push(formatContentLine(content.transformed, 'TRANSFORMED', prefix, maxLength));
  }
  if (content.encoded) {
    lines.push(formatContentLine(content.encoded, 'ENCODED', prefix, maxLength));
  }
  if (content.sent) {
    lines.push(formatContentLine(content.sent, 'SENT', prefix, maxLength));
  }
  if (content.response) {
    lines.push(formatContentLine(content.response, 'RESPONSE', prefix, maxLength));
  }
  if (content.processingError) {
    lines.push(`${prefix}${chalk.red('ERROR:')} ${content.processingError}`);
  }

  return lines;
}

/**
 * Format a single content line
 */
function formatContentLine(
  snapshot: ContentSnapshot,
  label: string,
  prefix: string,
  maxLength: number
): string {
  let preview = snapshot.content;
  if (preview.length > maxLength) {
    preview = preview.substring(0, maxLength);
  }

  // Normalize whitespace for display
  preview = preview
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sizeInfo = snapshot.truncated
    ? chalk.gray(` (${formatBytes(snapshot.fullLength)})`)
    : chalk.gray(` (${formatBytes(snapshot.fullLength)})`);

  return `${prefix}${chalk.gray('│')}  ${chalk.yellow(label + ':')} ${chalk.gray(preview)}${sizeInfo}`;
}

/**
 * Format byte count as human-readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} chars`;
  if (bytes < 1000000) return `${(bytes / 1000).toFixed(1)}K chars`;
  return `${(bytes / 1000000).toFixed(1)}M chars`;
}

/**
 * Get colored status icon
 */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'SENT':
      return chalk.green('●');
    case 'FILTERED':
      return chalk.yellow('○');
    case 'ERROR':
      return chalk.red('●');
    case 'QUEUED':
      return chalk.yellow('◐');
    case 'RECEIVED':
      return chalk.blue('●');
    case 'TRANSFORMED':
      return chalk.blue('●');
    case 'PENDING':
      return chalk.gray('○');
    case 'DELETED':
      return chalk.gray('✕');
    default:
      return chalk.gray('?');
  }
}

/**
 * Format status badge with color
 */
function formatStatus(status: string): string {
  switch (status) {
    case 'SENT':
      return chalk.green(`[${status}]`);
    case 'FILTERED':
      return chalk.yellow(`[${status}]`);
    case 'ERROR':
      return chalk.red(`[${status}]`);
    case 'QUEUED':
      return chalk.yellow(`[${status}]`);
    case 'RECEIVED':
      return chalk.blue(`[${status}]`);
    case 'TRANSFORMED':
      return chalk.blue(`[${status}]`);
    case 'PENDING':
      return chalk.gray(`[${status}]`);
    case 'DELETED':
      return chalk.gray(`[${status}]`);
    default:
      return chalk.gray(`[${status}]`);
  }
}

/**
 * Format a Date as HH:mm:ss.SSS
 */
function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}
