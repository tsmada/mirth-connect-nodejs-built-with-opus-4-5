/**
 * Cross-Channel Message Trace Service
 *
 * Reconstructs the complete message journey across VM-connected channels.
 * Given any message in any channel, traces backward to the original source
 * and forward to all downstream destinations, building a tree of TraceNodes.
 *
 * Relies on sourceMap data persisted in D_MC tables (ContentType.SOURCE_MAP = 15)
 * which carries sourceChannelIds[] and sourceMessageIds[] through the VM connector chain.
 */

import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../db/pool.js';
import { ChannelController } from '../../controllers/ChannelController.js';
import { ContentType } from '../../model/ContentType.js';
import { messageTable, connectorMessageTable, contentTable } from '../../db/DonkeyDao.js';
import {
  SOURCE_CHANNEL_ID,
  SOURCE_CHANNEL_IDS,
  SOURCE_MESSAGE_ID,
  SOURCE_MESSAGE_IDS,
} from '../../connectors/vm/VmConnectorProperties.js';

// =============================================================================
// Types
// =============================================================================

export interface ContentSnapshot {
  content: string;
  dataType: string;
  truncated: boolean;
  fullLength: number;
}

export interface TraceNodeContent {
  raw?: ContentSnapshot;
  transformed?: ContentSnapshot;
  encoded?: ContentSnapshot;
  sent?: ContentSnapshot;
  response?: ContentSnapshot;
  processingError?: string;
}

export interface TraceNode {
  channelId: string;
  channelName: string;
  messageId: number;
  receivedDate: string;
  status: string;
  connectorName: string;
  parentDestinationName?: string;
  latencyMs?: number;
  depth: number;
  content?: TraceNodeContent;
  error?: string;
  children: TraceNode[];
}

export interface TraceResult {
  root: TraceNode;
  totalNodes: number;
  maxDepth: number;
  totalLatencyMs: number;
  hasErrors: boolean;
  truncated: boolean;
}

export interface TraceOptions {
  includeContent: boolean;
  contentTypes: string[];
  maxContentLength: number;
  maxDepth: number;
  maxChildren: number;
  direction: 'both' | 'backward' | 'forward';
}

const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  includeContent: true,
  contentTypes: ['raw', 'transformed', 'response', 'error'],
  maxContentLength: 500,
  maxDepth: 10,
  maxChildren: 50,
  direction: 'both',
};

// =============================================================================
// Row interfaces
// =============================================================================

interface MessageRow extends RowDataPacket {
  ID: number;
  SERVER_ID: string;
  RECEIVED_DATE: Date;
  PROCESSED: number;
}

interface ConnectorMessageRow extends RowDataPacket {
  MESSAGE_ID: number;
  METADATA_ID: number;
  RECEIVED_DATE: Date;
  STATUS: string;
  CONNECTOR_NAME: string;
  ERROR_CODE: number | null;
}

interface ContentRow extends RowDataPacket {
  MESSAGE_ID: number;
  METADATA_ID: number;
  CONTENT_TYPE: number;
  CONTENT: string;
  DATA_TYPE: string;
}

interface SourceMapRow extends RowDataPacket {
  MESSAGE_ID: number;
  CONTENT: string;
}

// =============================================================================
// Dependency Graph
// =============================================================================

/** Map of channelId → target channelIds (via Channel Writer destinations) */
type DependencyGraph = Map<string, string[]>;

/**
 * Build a dependency graph of all channels connected via VM/Channel Writer.
 * For each channel, extract destination connectors with transportName === 'Channel Writer'
 * and map to the target channelId.
 */
async function buildChannelDependencyGraph(): Promise<DependencyGraph> {
  const channels = await ChannelController.getAllChannels();
  const graph: DependencyGraph = new Map();

  for (const channel of channels) {
    const targets: string[] = [];

    for (const dest of channel.destinationConnectors) {
      if (dest.transportName === 'Channel Writer' && dest.properties) {
        const targetId = dest.properties.channelId as string | undefined;
        if (targetId && targetId !== 'none') {
          targets.push(targetId);
        }
      }
    }

    if (targets.length > 0) {
      graph.set(channel.id, targets);
    }
  }

  return graph;
}

// =============================================================================
// Channel name lookup cache
// =============================================================================

let channelNamesCache: Record<string, string> | null = null;

async function getChannelNames(): Promise<Record<string, string>> {
  if (!channelNamesCache) {
    channelNamesCache = await ChannelController.getChannelIdsAndNames();
  }
  return channelNamesCache;
}

function getChannelName(names: Record<string, string>, channelId: string): string {
  return names[channelId] || channelId;
}

// =============================================================================
// Table existence check
// =============================================================================

async function tablesExist(channelId: string): Promise<boolean> {
  const pool = getPool();
  const tableName = messageTable(channelId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return rows.length > 0;
}

// =============================================================================
// Content fetching
// =============================================================================

const CONTENT_TYPE_MAP: Record<string, number> = {
  raw: ContentType.RAW,
  transformed: ContentType.TRANSFORMED,
  encoded: ContentType.ENCODED,
  sent: ContentType.SENT,
  response: ContentType.RESPONSE,
  error: ContentType.PROCESSING_ERROR,
};

async function fetchNodeContent(
  channelId: string,
  messageId: number,
  options: TraceOptions
): Promise<TraceNodeContent | undefined> {
  if (!options.includeContent) return undefined;
  if (!await tablesExist(channelId)) return undefined;

  const pool = getPool();
  const result: TraceNodeContent = {};

  // Fetch requested content types
  const typesToFetch: number[] = [];
  for (const typeName of options.contentTypes) {
    const typeNum = CONTENT_TYPE_MAP[typeName];
    if (typeNum !== undefined) {
      typesToFetch.push(typeNum);
    }
  }

  if (typesToFetch.length === 0) return undefined;

  const placeholders = typesToFetch.map(() => '?').join(', ');
  const [rows] = await pool.query<ContentRow[]>(
    `SELECT CONTENT_TYPE, CONTENT, DATA_TYPE
     FROM ${contentTable(channelId)}
     WHERE MESSAGE_ID = ? AND METADATA_ID = 0 AND CONTENT_TYPE IN (${placeholders})`,
    [messageId, ...typesToFetch]
  );

  for (const row of rows) {
    const snapshot = makeSnapshot(row.CONTENT, row.DATA_TYPE, options.maxContentLength);

    switch (row.CONTENT_TYPE) {
      case ContentType.RAW:
        result.raw = snapshot;
        break;
      case ContentType.TRANSFORMED:
        result.transformed = snapshot;
        break;
      case ContentType.ENCODED:
        result.encoded = snapshot;
        break;
      case ContentType.SENT:
        result.sent = snapshot;
        break;
      case ContentType.RESPONSE:
        result.response = snapshot;
        break;
      case ContentType.PROCESSING_ERROR:
        result.processingError = row.CONTENT;
        break;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function makeSnapshot(content: string | null, dataType: string, maxLength: number): ContentSnapshot {
  const fullContent = content || '';
  const truncated = fullContent.length > maxLength;

  return {
    content: truncated ? fullContent.substring(0, maxLength) : fullContent,
    dataType,
    truncated,
    fullLength: fullContent.length,
  };
}

// =============================================================================
// Status code mapping
// =============================================================================

const STATUS_MAP: Record<string, string> = {
  R: 'RECEIVED',
  F: 'FILTERED',
  T: 'TRANSFORMED',
  S: 'SENT',
  Q: 'QUEUED',
  E: 'ERROR',
  P: 'PENDING',
};

// =============================================================================
// Trace Backward (find root)
// =============================================================================

/**
 * Trace backward from a message to find the root of the chain.
 * Returns the chain of (channelId, messageId) from root to the starting point.
 */
async function traceBackward(
  channelId: string,
  messageId: number,
  maxDepth: number
): Promise<Array<{ channelId: string; messageId: number }>> {
  const chain: Array<{ channelId: string; messageId: number }> = [];
  let currentChannelId = channelId;
  let currentMessageId = messageId;
  const visited = new Set<string>();

  for (let depth = 0; depth < maxDepth; depth++) {
    const key = `${currentChannelId}:${currentMessageId}`;
    if (visited.has(key)) break; // circular reference guard
    visited.add(key);

    // Fetch source map for this message
    if (!await tablesExist(currentChannelId)) break;

    const pool = getPool();
    const [rows] = await pool.query<SourceMapRow[]>(
      `SELECT MESSAGE_ID, CONTENT FROM ${contentTable(currentChannelId)}
       WHERE MESSAGE_ID = ? AND METADATA_ID = 0 AND CONTENT_TYPE = ?`,
      [currentMessageId, ContentType.SOURCE_MAP]
    );

    if (rows.length === 0) {
      // No source map = this is the root
      chain.unshift({ channelId: currentChannelId, messageId: currentMessageId });
      break;
    }

    const sourceMap = safeParseJson(rows[0]!.CONTENT);
    if (!sourceMap) {
      chain.unshift({ channelId: currentChannelId, messageId: currentMessageId });
      break;
    }

    // Extract parent channel and message from source map
    const parentChannelIds = (sourceMap[SOURCE_CHANNEL_IDS] as string[] | undefined) || (
      sourceMap[SOURCE_CHANNEL_ID] ? [sourceMap[SOURCE_CHANNEL_ID] as string] : undefined
    );
    const parentMessageIds = (sourceMap[SOURCE_MESSAGE_IDS] as number[] | undefined) || (
      sourceMap[SOURCE_MESSAGE_ID] !== undefined ? [sourceMap[SOURCE_MESSAGE_ID] as number] : undefined
    );

    if (!parentChannelIds || !parentMessageIds || parentChannelIds.length === 0 || parentMessageIds.length === 0) {
      // No parent reference = this is the root
      chain.unshift({ channelId: currentChannelId, messageId: currentMessageId });
      break;
    }

    // Guard against mismatched array lengths (corrupted sourceMap)
    if (parentChannelIds.length !== parentMessageIds.length) {
      chain.unshift({ channelId: currentChannelId, messageId: currentMessageId });
      break;
    }

    chain.unshift({ channelId: currentChannelId, messageId: currentMessageId });

    // Move to the immediate parent (last in the chain = direct parent)
    currentChannelId = parentChannelIds[parentChannelIds.length - 1]!;
    currentMessageId = parentMessageIds[parentMessageIds.length - 1]!;
  }

  // If we exited the loop without adding the root, prepend it
  if (chain.length === 0 || chain[0]!.channelId !== currentChannelId || chain[0]!.messageId !== currentMessageId) {
    chain.unshift({ channelId: currentChannelId, messageId: currentMessageId });
  }

  return chain;
}

// =============================================================================
// Trace Forward (find downstream messages)
// =============================================================================

/**
 * Find downstream messages in a target channel that reference the given source.
 */
async function findDownstreamMessages(
  sourceChannelId: string,
  sourceMessageId: number,
  targetChannelId: string,
  maxChildren: number
): Promise<Array<{ messageId: number }>> {
  if (!await tablesExist(targetChannelId)) return [];

  const pool = getPool();

  // Search for source map entries that reference this channel+message
  // We use LIKE for the initial filter, then verify in application code
  const searchTerm = `"${SOURCE_CHANNEL_ID}":"${sourceChannelId}"`;
  const [rows] = await pool.query<SourceMapRow[]>(
    `SELECT MESSAGE_ID, CONTENT FROM ${contentTable(targetChannelId)}
     WHERE CONTENT_TYPE = ? AND METADATA_ID = 0
       AND CONTENT LIKE ?
     ORDER BY MESSAGE_ID DESC LIMIT ?`,
    [ContentType.SOURCE_MAP, `%${searchTerm}%`, maxChildren * 2] // Over-fetch for filtering
  );

  const results: Array<{ messageId: number }> = [];

  for (const row of rows) {
    if (results.length >= maxChildren) break;

    const sourceMap = safeParseJson(row.CONTENT);
    if (!sourceMap) continue;

    // Verify this message's direct parent is our source
    const srcId = sourceMap[SOURCE_CHANNEL_ID];
    const msgId = sourceMap[SOURCE_MESSAGE_ID];

    if (srcId === sourceChannelId && msgId === sourceMessageId) {
      results.push({ messageId: row.MESSAGE_ID });
    }

    // Also check the chain arrays (for multi-hop scenarios where direct parent may differ)
    const srcIds = sourceMap[SOURCE_CHANNEL_IDS] as string[] | undefined;
    const msgIds = sourceMap[SOURCE_MESSAGE_IDS] as number[] | undefined;

    if (srcIds && msgIds) {
      const lastIdx = srcIds.length - 1;
      if (srcIds[lastIdx] === sourceChannelId && msgIds[lastIdx] === sourceMessageId) {
        // Avoid duplicates
        if (!results.some(r => r.messageId === row.MESSAGE_ID)) {
          results.push({ messageId: row.MESSAGE_ID });
        }
      }
    }
  }

  return results;
}

/**
 * Build a TraceNode for a specific message, then recursively trace forward.
 */
async function buildTraceNode(
  channelId: string,
  messageId: number,
  depGraph: DependencyGraph,
  channelNames: Record<string, string>,
  rootReceivedDate: Date | null,
  depth: number,
  options: TraceOptions,
  visited: Set<string>,
  parentDestName?: string
): Promise<TraceNode | null> {
  const key = `${channelId}:${messageId}`;
  if (visited.has(key)) return null; // circular reference guard
  visited.add(key);

  if (!await tablesExist(channelId)) {
    return {
      channelId,
      channelName: getChannelName(channelNames, channelId),
      messageId,
      receivedDate: '',
      status: 'UNKNOWN',
      connectorName: 'Source',
      parentDestinationName: parentDestName,
      depth,
      error: 'Channel has no message data (not deployed?)',
      children: [],
    };
  }

  const pool = getPool();

  // Fetch message
  const [msgRows] = await pool.query<MessageRow[]>(
    `SELECT * FROM ${messageTable(channelId)} WHERE ID = ?`,
    [messageId]
  );

  if (msgRows.length === 0) {
    return {
      channelId,
      channelName: getChannelName(channelNames, channelId),
      messageId,
      receivedDate: '',
      status: 'DELETED',
      connectorName: 'Source',
      parentDestinationName: parentDestName,
      depth,
      error: 'Message deleted',
      children: [],
    };
  }

  const msg = msgRows[0]!;

  // Fetch source connector message (metaDataId = 0)
  const [cmRows] = await pool.query<ConnectorMessageRow[]>(
    `SELECT * FROM ${connectorMessageTable(channelId)}
     WHERE MESSAGE_ID = ? ORDER BY METADATA_ID`,
    [messageId]
  );

  const sourceConnectorMsg = cmRows.find(r => r.METADATA_ID === 0);
  const statusCode = sourceConnectorMsg?.STATUS || 'R';

  // Compute latency from root
  const receivedDate = msg.RECEIVED_DATE;
  let latencyMs: number | undefined;
  if (rootReceivedDate && depth > 0) {
    latencyMs = receivedDate.getTime() - rootReceivedDate.getTime();
  }

  // Fetch content
  const nodeContent = await fetchNodeContent(channelId, messageId, options);

  // Check for errors in any connector
  const hasError = cmRows.some(r => r.STATUS === 'E');
  let errorMsg: string | undefined;
  if (hasError && nodeContent?.processingError) {
    errorMsg = nodeContent.processingError;
  }

  const node: TraceNode = {
    channelId,
    channelName: getChannelName(channelNames, channelId),
    messageId,
    receivedDate: receivedDate.toISOString(),
    status: STATUS_MAP[statusCode] || statusCode,
    connectorName: sourceConnectorMsg?.CONNECTOR_NAME || 'Source',
    parentDestinationName: parentDestName,
    latencyMs,
    depth,
    content: nodeContent,
    error: errorMsg,
    children: [],
  };

  // If we're at max depth or only tracing backward, don't trace forward
  if (depth >= options.maxDepth || options.direction === 'backward') {
    return node;
  }

  // Find downstream channels via dependency graph
  const targets = depGraph.get(channelId) || [];

  // Look up destination connector names for each target
  const destConnectorNames = await getDestinationNames(channelId, targets);

  // Trace forward to each target channel in parallel
  // Each target is wrapped in try-catch so one failing channel doesn't crash the entire trace
  const forwardPromises = targets.map(async (targetChannelId) => {
    try {
      const downstreamMessages = await findDownstreamMessages(
        channelId, messageId, targetChannelId, options.maxChildren
      );

      const childPromises = downstreamMessages.map(async (dm) => {
        try {
          return await buildTraceNode(
            targetChannelId, dm.messageId, depGraph, channelNames,
            rootReceivedDate || receivedDate, depth + 1, options, visited,
            destConnectorNames.get(targetChannelId)
          );
        } catch (err) {
          // Return error node instead of crashing
          return {
            channelId: targetChannelId,
            channelName: getChannelName(channelNames, targetChannelId),
            messageId: dm.messageId,
            receivedDate: '',
            status: 'ERROR',
            connectorName: 'Source',
            parentDestinationName: destConnectorNames.get(targetChannelId),
            depth: depth + 1,
            error: `Trace failed: ${err instanceof Error ? err.message : String(err)}`,
            children: [],
          } satisfies TraceNode;
        }
      });

      return Promise.all(childPromises);
    } catch {
      return []; // Skip this target entirely if lookup fails
    }
  });

  const childArrays = await Promise.all(forwardPromises);
  for (const children of childArrays) {
    for (const child of children) {
      if (child) {
        node.children.push(child);
      }
    }
  }

  return node;
}

/**
 * Get destination connector names for target channels.
 */
async function getDestinationNames(
  channelId: string,
  targetChannelIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  try {
    const channel = await ChannelController.getChannel(channelId);
    if (!channel) return names;

    for (const dest of channel.destinationConnectors) {
      if (dest.transportName === 'Channel Writer' && dest.properties) {
        const targetId = dest.properties.channelId as string | undefined;
        if (targetId && targetChannelIds.includes(targetId)) {
          names.set(targetId, dest.name);
        }
      }
    }
  } catch {
    // Non-critical
  }

  return names;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Trace a message across all connected channels.
 *
 * @param channelId - Starting channel ID
 * @param messageId - Starting message ID
 * @param userOptions - Trace options (partial, merged with defaults)
 * @returns Complete trace result with tree structure
 */
export async function traceMessage(
  channelId: string,
  messageId: number,
  userOptions?: Partial<TraceOptions>
): Promise<TraceResult> {
  const options: TraceOptions = { ...DEFAULT_TRACE_OPTIONS, ...userOptions };

  // Reset channel names cache for fresh data
  channelNamesCache = null;
  const channelNames = await getChannelNames();

  // Build dependency graph
  const depGraph = await buildChannelDependencyGraph();

  // Determine starting point
  let rootChannelId = channelId;
  let rootMessageId = messageId;

  if (options.direction !== 'forward') {
    // Trace backward to find the root message
    const chain = await traceBackward(channelId, messageId, options.maxDepth);
    if (chain.length > 0) {
      rootChannelId = chain[0]!.channelId;
      rootMessageId = chain[0]!.messageId;
    }
  }

  // Build the trace tree from root
  const visited = new Set<string>();
  const root = await buildTraceNode(
    rootChannelId, rootMessageId, depGraph, channelNames,
    null, 0, options, visited
  );

  if (!root) {
    throw new Error(`Message not found: channel=${channelId}, messageId=${messageId}`);
  }

  // Compute summary stats
  const stats = computeStats(root);

  return {
    root,
    totalNodes: stats.totalNodes,
    maxDepth: stats.maxDepth,
    totalLatencyMs: stats.maxLatency,
    hasErrors: stats.hasErrors,
    truncated: stats.totalNodes >= options.maxDepth * options.maxChildren,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function safeParseJson(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

interface TraceStats {
  totalNodes: number;
  maxDepth: number;
  maxLatency: number;
  hasErrors: boolean;
}

function computeStats(node: TraceNode): TraceStats {
  let totalNodes = 1;
  let maxDepth = node.depth;
  let maxLatency = node.latencyMs || 0;
  let hasErrors = node.status === 'ERROR' || !!node.error;

  for (const child of node.children) {
    const childStats = computeStats(child);
    totalNodes += childStats.totalNodes;
    maxDepth = Math.max(maxDepth, childStats.maxDepth);
    maxLatency = Math.max(maxLatency, childStats.maxLatency);
    hasErrors = hasErrors || childStats.hasErrors;
  }

  return { totalNodes, maxDepth, maxLatency, hasErrors };
}
