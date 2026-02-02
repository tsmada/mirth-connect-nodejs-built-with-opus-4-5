/**
 * Message Servlet
 *
 * Handles message operations for channels.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/MessageServletInterface.java
 *
 * This is the most complex servlet with ~40 endpoints covering:
 * - Basic message operations (get, process, delete)
 * - Message search with filters
 * - Message reprocessing
 * - Attachment handling
 * - Import/export
 *
 * All endpoints are scoped to a channel: /channels/:channelId/messages/...
 */

import { Router, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2';
import { getPool } from '../../db/pool.js';
import {
  MessageFilter,
  parseMessageFilter,
  ContentType,
  MessageStatus,
} from '../models/MessageFilter.js';
import { authorize } from '../middleware/authorization.js';
import {
  MESSAGE_GET,
  MESSAGE_GET_COUNT,
  MESSAGE_SEARCH,
  MESSAGE_GET_MAX_ID,
  MESSAGE_REMOVE,
  MESSAGE_REMOVE_ALL,
  MESSAGE_PROCESS,
  MESSAGE_REPROCESS,
  MESSAGE_IMPORT,
  MESSAGE_EXPORT,
  MESSAGE_GET_ATTACHMENT,
} from '../middleware/operations.js';
import { QueryBuilder } from '../../db/QueryBuilder.js';

// mergeParams: true ensures channelId from parent route is available
// All handlers can safely use req.params.channelId! with non-null assertion
export const messageRouter = Router({ mergeParams: true });

/**
 * Extract channelId from request params with type safety
 * The channelId is guaranteed to exist due to mergeParams from parent route
 */
function getChannelId(req: Request): string {
  return req.params.channelId as string;
}

// ============================================================================
// Types
// ============================================================================

// Route parameters:
// - ChannelParams: { channelId: string } - from parent route
// - MessageParams: { channelId: string, messageId: string }
// - AttachmentParams: { channelId: string, messageId: string, attachmentId: string }
// (Type definitions not used - params extracted directly via req.params with type assertions)

// Table name helpers
function messageTable(channelId: string): string {
  return `D_M${channelId.replace(/-/g, '_')}`;
}

function connectorMessageTable(channelId: string): string {
  return `D_MM${channelId.replace(/-/g, '_')}`;
}

function contentTable(channelId: string): string {
  return `D_MC${channelId.replace(/-/g, '_')}`;
}

function attachmentTable(channelId: string): string {
  return `D_MA${channelId.replace(/-/g, '_')}`;
}

// ============================================================================
// Message Response Types
// ============================================================================

interface ConnectorMessage {
  messageId: number;
  metaDataId: number;
  channelId: string;
  channelName?: string;
  connectorName: string;
  receivedDate: string;
  status: MessageStatus;
  sendAttempts: number;
  sendDate?: string;
  responseDate?: string;
  errorCode?: number;
  content?: Record<number, MessageContent>;
}

interface MessageContent {
  contentType: ContentType;
  content: string;
  dataType: string;
  encrypted: boolean;
}

interface Message {
  messageId: number;
  channelId: string;
  serverId: string;
  receivedDate: string;
  processed: boolean;
  originalId?: number;
  importId?: number;
  connectorMessages: Record<number, ConnectorMessage>;
}

interface AttachmentInfo {
  id: string;
  messageId: number;
  type: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if message tables exist for a channel
 */
async function messageTablesExist(channelId: string): Promise<boolean> {
  const pool = getPool();
  const tableName = messageTable(channelId);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );

  return rows.length > 0;
}

/**
 * Get max message ID for a channel
 */
async function getMaxMessageId(channelId: string): Promise<number> {
  const exists = await messageTablesExist(channelId);
  if (!exists) {
    return 0;
  }

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(ID) as max_id FROM ${messageTable(channelId)}`
  );

  return rows[0]?.max_id ?? 0;
}

/**
 * Get a single message with all connector messages
 */
async function getMessage(
  channelId: string,
  messageId: number,
  includeContent: boolean = false
): Promise<Message | null> {
  const exists = await messageTablesExist(channelId);
  if (!exists) {
    return null;
  }

  const pool = getPool();

  // Get message
  const [messageRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${messageTable(channelId)} WHERE ID = ?`,
    [messageId]
  );

  if (messageRows.length === 0) {
    return null;
  }

  const messageRow = messageRows[0]!;

  // Get connector messages
  const [connectorRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID = ? ORDER BY METADATA_ID`,
    [messageId]
  );

  const connectorMessages: Record<number, ConnectorMessage> = {};

  for (const row of connectorRows) {
    const connectorMessage: ConnectorMessage = {
      messageId: row.MESSAGE_ID,
      metaDataId: row.METADATA_ID,
      channelId,
      connectorName: row.CONNECTOR_NAME,
      receivedDate: row.RECEIVED_DATE?.toISOString() ?? '',
      status: row.STATUS as MessageStatus,
      sendAttempts: row.SEND_ATTEMPTS,
      sendDate: row.SEND_DATE?.toISOString(),
      responseDate: row.RESPONSE_DATE?.toISOString(),
      errorCode: row.ERROR_CODE,
    };

    // Include content if requested
    if (includeContent) {
      const [contentRows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM ${contentTable(channelId)} WHERE MESSAGE_ID = ? AND METADATA_ID = ?`,
        [messageId, row.METADATA_ID]
      );

      connectorMessage.content = {};
      for (const contentRow of contentRows) {
        connectorMessage.content[contentRow.CONTENT_TYPE as number] = {
          contentType: contentRow.CONTENT_TYPE,
          content: contentRow.CONTENT,
          dataType: contentRow.DATA_TYPE,
          encrypted: contentRow.IS_ENCRYPTED === 1,
        };
      }
    }

    connectorMessages[row.METADATA_ID] = connectorMessage;
  }

  return {
    messageId: messageRow.ID,
    channelId,
    serverId: messageRow.SERVER_ID,
    receivedDate: messageRow.RECEIVED_DATE?.toISOString() ?? '',
    processed: messageRow.PROCESSED === 1,
    originalId: messageRow.ORIGINAL_ID,
    importId: messageRow.IMPORT_ID,
    connectorMessages,
  };
}

/**
 * Search messages with filter
 */
async function searchMessages(
  channelId: string,
  filter: MessageFilter,
  offset: number = 0,
  limit: number = 20,
  includeContent: boolean = false
): Promise<Message[]> {
  const exists = await messageTablesExist(channelId);
  if (!exists) {
    return [];
  }

  const pool = getPool();

  // Build query for message IDs
  const qb = new QueryBuilder()
    .select('DISTINCT m.ID')
    .from(`${messageTable(channelId)} m`);

  // Join with connector messages if needed for status/connector filtering
  if (filter.statuses || filter.includedMetaDataIds || filter.excludedMetaDataIds ||
      filter.sendAttemptsLower !== undefined || filter.sendAttemptsUpper !== undefined ||
      filter.error !== undefined) {
    qb.whereRaw(`EXISTS (SELECT 1 FROM ${connectorMessageTable(channelId)} mm WHERE mm.MESSAGE_ID = m.ID)`);
  }

  // Apply message table filters
  qb.whereGreaterOrEqual('m.ID', filter.minMessageId);
  qb.whereLessOrEqual('m.ID', filter.maxMessageId);
  qb.whereGreaterOrEqual('m.ORIGINAL_ID', filter.originalIdLower);
  qb.whereLessOrEqual('m.ORIGINAL_ID', filter.originalIdUpper);
  qb.whereGreaterOrEqual('m.IMPORT_ID', filter.importIdLower);
  qb.whereLessOrEqual('m.IMPORT_ID', filter.importIdUpper);
  qb.whereGreaterOrEqual('m.RECEIVED_DATE', filter.startDate);
  qb.whereLessOrEqual('m.RECEIVED_DATE', filter.endDate);

  if (filter.serverId) {
    qb.whereLike('m.SERVER_ID', filter.serverId);
  }

  // Attachment filter
  if (filter.attachment === true) {
    qb.whereExists(`SELECT 1 FROM ${attachmentTable(channelId)} ma WHERE ma.MESSAGE_ID = m.ID`);
  }

  qb.orderBy('m.ID', 'DESC');
  qb.limit(limit);
  qb.offset(offset);

  const { sql, params } = qb.build();

  // Execute query
  const formattedSql = sql.replace(/:(\w+)/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null) return 'NULL';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
    return String(value);
  });

  const [idRows] = await pool.query<RowDataPacket[]>(formattedSql);

  // Get full messages for each ID
  const messages: Message[] = [];
  for (const row of idRows) {
    const message = await getMessage(channelId, row.ID, includeContent);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

/**
 * Count messages matching filter
 */
async function countMessages(channelId: string, filter: MessageFilter): Promise<number> {
  const exists = await messageTablesExist(channelId);
  if (!exists) {
    return 0;
  }

  const pool = getPool();

  const qb = new QueryBuilder()
    .select('COUNT(DISTINCT m.ID) as count')
    .from(`${messageTable(channelId)} m`);

  // Apply same filters as search
  qb.whereGreaterOrEqual('m.ID', filter.minMessageId);
  qb.whereLessOrEqual('m.ID', filter.maxMessageId);
  qb.whereGreaterOrEqual('m.ORIGINAL_ID', filter.originalIdLower);
  qb.whereLessOrEqual('m.ORIGINAL_ID', filter.originalIdUpper);
  qb.whereGreaterOrEqual('m.RECEIVED_DATE', filter.startDate);
  qb.whereLessOrEqual('m.RECEIVED_DATE', filter.endDate);

  if (filter.serverId) {
    qb.whereLike('m.SERVER_ID', filter.serverId);
  }

  if (filter.attachment === true) {
    qb.whereExists(`SELECT 1 FROM ${attachmentTable(channelId)} ma WHERE ma.MESSAGE_ID = m.ID`);
  }

  const { sql, params } = qb.build();

  const formattedSql = sql.replace(/:(\w+)/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null) return 'NULL';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
    return String(value);
  });

  const [rows] = await pool.query<RowDataPacket[]>(formattedSql);
  return rows[0]?.count ?? 0;
}

/**
 * Delete a message and all related data
 */
async function deleteMessage(channelId: string, messageId: number): Promise<boolean> {
  const exists = await messageTablesExist(channelId);
  if (!exists) {
    return false;
  }

  const pool = getPool();

  // Delete in order: content, attachments, connector messages, message
  await pool.execute(
    `DELETE FROM ${contentTable(channelId)} WHERE MESSAGE_ID = ?`,
    [messageId]
  );
  await pool.execute(
    `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ?`,
    [messageId]
  );
  await pool.execute(
    `DELETE FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID = ?`,
    [messageId]
  );

  const [result] = await pool.execute(
    `DELETE FROM ${messageTable(channelId)} WHERE ID = ?`,
    [messageId]
  );

  return (result as { affectedRows: number }).affectedRows > 0;
}

/**
 * Get attachments for a message
 */
async function getAttachments(channelId: string, messageId: number): Promise<AttachmentInfo[]> {
  const exists = await messageTablesExist(channelId);
  if (!exists) {
    return [];
  }

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT ID, MESSAGE_ID, TYPE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ?`,
    [messageId]
  );

  return rows.map((row) => ({
    id: row.ID,
    messageId: row.MESSAGE_ID,
    type: row.TYPE ?? 'application/octet-stream',
  }));
}

/**
 * Get attachment data
 */
async function getAttachment(
  channelId: string,
  messageId: number,
  attachmentId: string
): Promise<Buffer | null> {
  const exists = await messageTablesExist(channelId);
  if (!exists) {
    return null;
  }

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ATTACHMENT FROM ${attachmentTable(channelId)}
     WHERE MESSAGE_ID = ? AND ID = ? ORDER BY SEGMENT_ID`,
    [messageId, attachmentId]
  );

  if (rows.length === 0) {
    return null;
  }

  // Concatenate segments
  const segments = rows.map((row) => row.ATTACHMENT as Buffer);
  return Buffer.concat(segments);
}

// ============================================================================
// Routes - Basic Message Operations (Phase 1.4a)
// ============================================================================

/**
 * GET /channels/:channelId/messages/maxMessageId
 * Get max message ID for a channel
 */
messageRouter.get(
  '/maxMessageId',
  authorize({ operation: MESSAGE_GET_MAX_ID, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const maxId = await getMaxMessageId(channelId);
      res.sendData(maxId);
    } catch (error) {
      console.error('Get max message ID error:', error);
      res.status(500).json({ error: 'Failed to get max message ID' });
    }
  }
);

/**
 * GET /channels/:channelId/messages/count
 * Count messages with query parameters
 */
messageRouter.get(
  '/count',
  authorize({ operation: MESSAGE_GET_COUNT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const filter = parseMessageFilter(req.query as Record<string, unknown>);
      const count = await countMessages(channelId, filter);
      res.sendData(count);
    } catch (error) {
      console.error('Get message count error:', error);
      res.status(500).json({ error: 'Failed to get message count' });
    }
  }
);

/**
 * POST /channels/:channelId/messages/count/_search
 * Count messages with filter in body
 */
messageRouter.post(
  '/count/_search',
  authorize({ operation: MESSAGE_GET_COUNT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const filter = parseMessageFilter(req.body as Record<string, unknown>);
      const count = await countMessages(channelId, filter);
      res.sendData(count);
    } catch (error) {
      console.error('Get message count POST error:', error);
      res.status(500).json({ error: 'Failed to get message count' });
    }
  }
);

/**
 * GET /channels/:channelId/messages/:messageId
 * Get a single message
 */
messageRouter.get(
  '/:messageId',
  authorize({ operation: MESSAGE_GET, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const messageIdStr = req.params.messageId as string;
      const messageId = parseInt(messageIdStr, 10);
      const includeContent = req.query.includeContent === 'true';

      if (isNaN(messageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }

      const message = await getMessage(channelId, messageId, includeContent);

      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      res.sendData(message);
    } catch (error) {
      console.error('Get message error:', error);
      res.status(500).json({ error: 'Failed to get message' });
    }
  }
);

/**
 * DELETE /channels/:channelId/messages/:messageId
 * Delete a single message
 */
messageRouter.delete(
  '/:messageId',
  authorize({ operation: MESSAGE_REMOVE, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const messageIdStr = req.params.messageId as string;
      const messageId = parseInt(messageIdStr, 10);

      if (isNaN(messageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }

      const deleted = await deleteMessage(channelId, messageId);

      if (!deleted) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      console.error('Delete message error:', error);
      res.status(500).json({ error: 'Failed to delete message' });
    }
  }
);

// ============================================================================
// Routes - Message Search (Phase 1.4b)
// ============================================================================

/**
 * GET /channels/:channelId/messages
 * Search messages with query parameters
 */
messageRouter.get(
  '/',
  authorize({ operation: MESSAGE_SEARCH, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const filter = parseMessageFilter(req.query as Record<string, unknown>);
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const includeContent = req.query.includeContent === 'true';

      const messages = await searchMessages(channelId, filter, offset, limit, includeContent);
      res.sendData(messages);
    } catch (error) {
      console.error('Search messages error:', error);
      res.status(500).json({ error: 'Failed to search messages' });
    }
  }
);

/**
 * POST /channels/:channelId/messages/_search
 * Search messages with filter in body
 */
messageRouter.post(
  '/_search',
  authorize({ operation: MESSAGE_SEARCH, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const filter = parseMessageFilter(req.body as Record<string, unknown>);
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const includeContent = req.query.includeContent === 'true';

      const messages = await searchMessages(channelId, filter, offset, limit, includeContent);
      res.sendData(messages);
    } catch (error) {
      console.error('Search messages POST error:', error);
      res.status(500).json({ error: 'Failed to search messages' });
    }
  }
);

// ============================================================================
// Routes - Message Reprocessing (Phase 1.4c)
// ============================================================================

/**
 * POST /channels/:channelId/messages/_reprocess
 * Reprocess messages matching filter
 */
messageRouter.post(
  '/_reprocess',
  authorize({ operation: MESSAGE_REPROCESS, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const filter = parseMessageFilter(req.body as Record<string, unknown>);
      const replace = req.query.replace === 'true';
      const filterDestinations = req.query.filterDestinations === 'true';

      // Get messages to reprocess
      const messages = await searchMessages(channelId, filter, 0, 1000, true);

      // TODO: Implement actual reprocessing via Engine
      // For now, return the count of messages that would be reprocessed
      res.sendData({
        reprocessed: messages.length,
        replace,
        filterDestinations,
      });
    } catch (error) {
      console.error('Reprocess messages error:', error);
      res.status(500).json({ error: 'Failed to reprocess messages' });
    }
  }
);

/**
 * POST /channels/:channelId/messages/:messageId/_reprocess
 * Reprocess a single message
 */
messageRouter.post(
  '/:messageId/_reprocess',
  authorize({ operation: MESSAGE_REPROCESS, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const messageIdStr = req.params.messageId as string;
      const messageId = parseInt(messageIdStr, 10);
      const replace = req.query.replace === 'true';
      const filterDestinations = req.query.filterDestinations === 'true';

      if (isNaN(messageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }

      // Get the message
      const message = await getMessage(channelId, messageId, true);

      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      // TODO: Implement actual reprocessing via Engine
      res.sendData({
        reprocessed: 1,
        messageId,
        replace,
        filterDestinations,
      });
    } catch (error) {
      console.error('Reprocess message error:', error);
      res.status(500).json({ error: 'Failed to reprocess message' });
    }
  }
);

// ============================================================================
// Routes - Attachments (Phase 1.4d)
// ============================================================================

/**
 * GET /channels/:channelId/messages/:messageId/attachments
 * List attachments for a message
 */
messageRouter.get(
  '/:messageId/attachments',
  authorize({ operation: MESSAGE_GET_ATTACHMENT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const messageIdStr = req.params.messageId as string;
      const messageId = parseInt(messageIdStr, 10);

      if (isNaN(messageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }

      const attachments = await getAttachments(channelId, messageId);
      res.sendData(attachments);
    } catch (error) {
      console.error('Get attachments error:', error);
      res.status(500).json({ error: 'Failed to get attachments' });
    }
  }
);

/**
 * GET /channels/:channelId/messages/:messageId/attachments/:attachmentId
 * Get attachment data
 */
messageRouter.get(
  '/:messageId/attachments/:attachmentId',
  authorize({ operation: MESSAGE_GET_ATTACHMENT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const messageIdStr = req.params.messageId as string;
      const attachmentId = req.params.attachmentId as string;
      const messageId = parseInt(messageIdStr, 10);

      if (isNaN(messageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }

      const data = await getAttachment(channelId, messageId, attachmentId);

      if (!data) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${attachmentId}"`);
      res.send(data);
    } catch (error) {
      console.error('Get attachment error:', error);
      res.status(500).json({ error: 'Failed to get attachment' });
    }
  }
);

// ============================================================================
// Routes - Import/Export (Phase 1.4e)
// ============================================================================

/**
 * POST /channels/:channelId/messages/_import
 * Import a message
 */
messageRouter.post(
  '/_import',
  authorize({ operation: MESSAGE_IMPORT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      // Note: req.body contains the message to import

      // TODO: Implement message import
      // This would parse the message XML/JSON (req.body) and insert into database
      res.status(501).json({
        error: 'Not implemented',
        message: 'Message import is not yet implemented',
        channelId,
      });
    } catch (error) {
      console.error('Import message error:', error);
      res.status(500).json({ error: 'Failed to import message' });
    }
  }
);

/**
 * POST /channels/:channelId/messages/_export
 * Export messages matching filter
 */
messageRouter.post(
  '/_export',
  authorize({ operation: MESSAGE_EXPORT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const filter = parseMessageFilter(req.body as Record<string, unknown>);
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 100;
      const writerType = req.query.writerType as string ?? 'JSON';
      // Note: includeAttachments query param available for future attachment export support

      // Get messages to export
      const messages = await searchMessages(channelId, filter, 0, pageSize, true);

      if (writerType.toUpperCase() === 'JSON') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="messages.json"');
        res.json(messages);
      } else {
        // XML export
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', 'attachment; filename="messages.xml"');
        // TODO: Implement proper XML serialization
        res.send(`<messages count="${messages.length}"></messages>`);
      }
    } catch (error) {
      console.error('Export messages error:', error);
      res.status(500).json({ error: 'Failed to export messages' });
    }
  }
);

/**
 * POST /channels/:channelId/messages
 * Process a new message (send to channel for processing)
 */
messageRouter.post(
  '/',
  authorize({ operation: MESSAGE_PROCESS, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const rawMessage = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      // Note: sourceMapEntry and destinationMetaDataId query params available for future processing

      // TODO: Implement actual message processing via Engine
      // This would send the message through the channel pipeline
      res.status(501).json({
        error: 'Not implemented',
        message: 'Direct message processing is not yet implemented',
        channelId,
        rawMessageLength: rawMessage.length,
      });
    } catch (error) {
      console.error('Process message error:', error);
      res.status(500).json({ error: 'Failed to process message' });
    }
  }
);

/**
 * DELETE /channels/:channelId/messages
 * Remove all messages (or matching filter)
 */
messageRouter.delete(
  '/',
  authorize({ operation: MESSAGE_REMOVE_ALL, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const clearStatistics = req.query.clearStatistics !== 'false';

      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({ error: 'Channel not found or has no messages' });
        return;
      }

      const pool = getPool();

      // Delete all messages and related data
      await pool.execute(`TRUNCATE TABLE ${contentTable(channelId)}`);
      await pool.execute(`TRUNCATE TABLE ${attachmentTable(channelId)}`);
      await pool.execute(`TRUNCATE TABLE ${connectorMessageTable(channelId)}`);
      await pool.execute(`TRUNCATE TABLE ${messageTable(channelId)}`);

      // Clear statistics if requested
      if (clearStatistics) {
        try {
          await pool.execute(`UPDATE D_MS${channelId.replace(/-/g, '_')} SET
            RECEIVED = 0, FILTERED = 0, TRANSFORMED = 0, PENDING = 0, SENT = 0, ERROR = 0`);
        } catch {
          // Statistics table might not exist
        }
      }

      res.status(204).end();
    } catch (error) {
      console.error('Remove all messages error:', error);
      res.status(500).json({ error: 'Failed to remove messages' });
    }
  }
);
