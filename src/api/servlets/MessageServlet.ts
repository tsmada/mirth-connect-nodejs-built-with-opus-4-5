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
import * as multer from 'multer';
import * as crypto from 'crypto';
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
  MESSAGE_CREATE_ATTACHMENT,
  MESSAGE_UPDATE_ATTACHMENT,
  MESSAGE_DELETE_ATTACHMENT,
  MESSAGE_IMPORT_MULTIPART,
  MESSAGE_EXPORT_ENCRYPTED,
  MESSAGE_REPROCESS_BULK,
  MESSAGE_GET_CONTENT,
  MESSAGE_UPDATE_CONTENT,
} from '../middleware/operations.js';
import { QueryBuilder } from '../../db/QueryBuilder.js';
import { EngineController } from '../../controllers/EngineController.js';
import {
  messageTable,
  connectorMessageTable,
  contentTable,
  attachmentTable,
  statisticsTable,
  sequenceTable,
} from '../../db/DonkeyDao.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

// Configure multer for multipart file uploads
const upload = multer.default({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

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

// Table name helpers imported from DonkeyDao (with UUID validation)

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
  const qb = new QueryBuilder().select('DISTINCT m.ID').from(`${messageTable(channelId)} m`);

  // Join with connector messages if needed for status/connector filtering
  if (
    filter.statuses ||
    filter.includedMetaDataIds ||
    filter.excludedMetaDataIds ||
    filter.sendAttemptsLower !== undefined ||
    filter.sendAttemptsUpper !== undefined ||
    filter.error !== undefined
  ) {
    qb.whereRaw(
      `EXISTS (SELECT 1 FROM ${connectorMessageTable(channelId)} mm WHERE mm.MESSAGE_ID = m.ID)`
    );
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
  await pool.execute(`DELETE FROM ${contentTable(channelId)} WHERE MESSAGE_ID = ?`, [messageId]);
  await pool.execute(`DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ?`, [messageId]);
  await pool.execute(`DELETE FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID = ?`, [
    messageId,
  ]);

  const [result] = await pool.execute(`DELETE FROM ${messageTable(channelId)} WHERE ID = ?`, [
    messageId,
  ]);

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
      logger.error('Get max message ID error', error as Error);
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
      logger.error('Get message count error', error as Error);
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
      logger.error('Get message count POST error', error as Error);
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
      logger.error('Get message error', error as Error);
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
      logger.error('Delete message error', error as Error);
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
      logger.error('Search messages error', error as Error);
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
      logger.error('Search messages POST error', error as Error);
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

      // Check if channel is deployed
      if (!EngineController.isDeployed(channelId)) {
        res.status(400).json({
          error: 'Channel not deployed',
          message: 'Channel must be deployed to reprocess messages',
        });
        return;
      }

      // Reprocess each message
      const results: Array<{ originalId: number; newMessageId: number; success: boolean }> = [];
      for (const message of messages) {
        try {
          // Get the original raw content from connector message 0
          const sourceConnector = message.connectorMessages[0];
          const rawContent = sourceConnector?.content?.[1]?.content ?? ''; // ContentType.RAW = 1

          if (rawContent) {
            // Create source map with reprocessing metadata
            const sourceMap = new Map<string, unknown>();
            sourceMap.set('reprocessed', true);
            sourceMap.set('originalMessageId', message.messageId);
            if (replace) {
              sourceMap.set('replaceMessage', true);
            }
            if (filterDestinations) {
              sourceMap.set('filterDestinations', true);
            }

            const result = await EngineController.dispatchMessage(channelId, rawContent, sourceMap);
            results.push({
              originalId: message.messageId,
              newMessageId: result.messageId,
              success: true,
            });
          }
        } catch (error) {
          results.push({
            originalId: message.messageId,
            newMessageId: 0,
            success: false,
          });
        }
      }

      res.sendData({
        reprocessed: results.filter((r) => r.success).length,
        total: messages.length,
        results,
      });
    } catch (error) {
      logger.error('Reprocess messages error', error as Error);
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

      // Get the message with content
      const message = await getMessage(channelId, messageId, true);

      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      // Check if channel is deployed
      if (!EngineController.isDeployed(channelId)) {
        res.status(400).json({
          error: 'Channel not deployed',
          message: 'Channel must be deployed to reprocess messages',
        });
        return;
      }

      // Get the original raw content from connector message 0 (source)
      const sourceConnector = message.connectorMessages[0];
      const rawContent = sourceConnector?.content?.[1]?.content ?? ''; // ContentType.RAW = 1

      if (!rawContent) {
        res.status(400).json({
          error: 'No raw content',
          message: 'Message has no raw content to reprocess',
        });
        return;
      }

      // Create source map with reprocessing metadata
      const sourceMap = new Map<string, unknown>();
      sourceMap.set('reprocessed', true);
      sourceMap.set('originalMessageId', messageId);
      if (replace) {
        sourceMap.set('replaceMessage', true);
      }
      if (filterDestinations) {
        sourceMap.set('filterDestinations', true);
      }

      // Dispatch the message
      const result = await EngineController.dispatchMessage(channelId, rawContent, sourceMap);

      res.sendData({
        reprocessed: 1,
        originalMessageId: messageId,
        newMessageId: result.messageId,
        processed: result.processed,
        replace,
        filterDestinations,
      });
    } catch (error) {
      logger.error('Reprocess message error', error as Error);
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
      logger.error('Get attachments error', error as Error);
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
      logger.error('Get attachment error', error as Error);
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

      // Validate message tables exist
      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({
          error: 'Channel not found',
          message: 'Channel message tables do not exist',
        });
        return;
      }

      // Parse the imported message from request body
      const importedMessage = req.body as {
        messageId?: number;
        serverId?: string;
        receivedDate?: string;
        processed?: boolean;
        connectorMessages?: Record<
          number,
          {
            metaDataId: number;
            connectorName: string;
            status: string;
            content?: Record<number, { contentType: number; content: string; dataType: string }>;
          }
        >;
      };

      if (!importedMessage || !importedMessage.connectorMessages) {
        res.status(400).json({
          error: 'Invalid message format',
          message: 'Message must contain connectorMessages',
        });
        return;
      }

      const pool = getPool();

      // Get next message ID
      const [seqRows] = await pool.query<RowDataPacket[]>(
        `SELECT ID FROM ${sequenceTable(channelId)} FOR UPDATE`
      );
      const nextId = (seqRows[0]?.ID ?? 0) + 1;
      await pool.execute(`UPDATE ${sequenceTable(channelId)} SET ID = ?`, [nextId]);

      // Insert message
      const receivedDate = importedMessage.receivedDate
        ? new Date(importedMessage.receivedDate)
        : new Date();

      await pool.execute(
        `INSERT INTO ${messageTable(channelId)}
         (ID, SERVER_ID, RECEIVED_DATE, PROCESSED, IMPORT_ID)
         VALUES (?, ?, ?, ?, ?)`,
        [
          nextId,
          importedMessage.serverId ?? 'import',
          receivedDate,
          importedMessage.processed ? 1 : 0,
          importedMessage.messageId ?? null, // Original ID stored as IMPORT_ID
        ]
      );

      // Insert connector messages and content
      for (const [metaDataIdStr, connectorMsg] of Object.entries(
        importedMessage.connectorMessages
      )) {
        const metaDataId = parseInt(metaDataIdStr, 10);

        await pool.execute(
          `INSERT INTO ${connectorMessageTable(channelId)}
           (MESSAGE_ID, METADATA_ID, CONNECTOR_NAME, RECEIVED_DATE, STATUS)
           VALUES (?, ?, ?, ?, ?)`,
          [nextId, metaDataId, connectorMsg.connectorName, receivedDate, connectorMsg.status]
        );

        // Insert content
        if (connectorMsg.content) {
          for (const [contentTypeStr, content] of Object.entries(connectorMsg.content)) {
            const contentType = parseInt(contentTypeStr, 10);
            await pool.execute(
              `INSERT INTO ${contentTable(channelId)}
               (MESSAGE_ID, METADATA_ID, CONTENT_TYPE, CONTENT, DATA_TYPE, IS_ENCRYPTED)
               VALUES (?, ?, ?, ?, ?, 0)`,
              [nextId, metaDataId, contentType, content.content, content.dataType]
            );
          }
        }
      }

      res.sendData({
        imported: true,
        messageId: nextId,
        originalId: importedMessage.messageId,
      });
    } catch (error) {
      logger.error('Import message error', error as Error);
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
      const writerType = (req.query.writerType as string) ?? 'JSON';
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
      logger.error('Export messages error', error as Error);
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

      // Check if channel is deployed
      if (!EngineController.isDeployed(channelId)) {
        res.status(400).json({
          error: 'Channel not deployed',
          message: 'Channel must be deployed to process messages',
        });
        return;
      }

      // Get raw message content
      const rawMessage = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

      // Build source map from query parameters
      const sourceMap = new Map<string, unknown>();

      // Parse sourceMapEntry (comma-separated key=value pairs)
      const sourceMapEntry = req.query.sourceMapEntry as string | undefined;
      if (sourceMapEntry) {
        const entries = sourceMapEntry.split(',');
        for (const entry of entries) {
          const [key, value] = entry.split('=');
          if (key && value !== undefined) {
            sourceMap.set(key.trim(), value.trim());
          }
        }
      }

      // Parse destination filter
      const destinationMetaDataIdStr = req.query.destinationMetaDataId as string | undefined;
      if (destinationMetaDataIdStr) {
        const destinationMetaDataIds = destinationMetaDataIdStr
          .split(',')
          .map((id) => parseInt(id.trim(), 10))
          .filter((id) => !isNaN(id));
        if (destinationMetaDataIds.length > 0) {
          sourceMap.set('destinationMetaDataIds', destinationMetaDataIds);
        }
      }

      // Dispatch message through the channel
      const result = await EngineController.dispatchMessage(channelId, rawMessage, sourceMap);

      res.sendData({
        messageId: result.messageId,
        processed: result.processed,
      });
    } catch (error) {
      logger.error('Process message error', error as Error);
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
          await pool.execute(`UPDATE ${statisticsTable(channelId)} SET
            RECEIVED = 0, FILTERED = 0, TRANSFORMED = 0, PENDING = 0, SENT = 0, ERROR = 0`);
        } catch {
          // Statistics table might not exist
        }
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Remove all messages error', error as Error);
      res.status(500).json({ error: 'Failed to remove messages' });
    }
  }
);

/**
 * POST /channels/:channelId/messages/_remove
 * Remove messages matching a filter
 * Called by GUI "Remove Messages" button with filter criteria
 */
messageRouter.post(
  '/_remove',
  authorize({ operation: MESSAGE_REMOVE, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const filter = parseMessageFilter(req.body as Record<string, unknown>);
      const clearStatistics = req.query.clearStatistics !== 'false';

      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({ error: 'Channel not found or has no messages' });
        return;
      }

      // Search for messages matching filter
      const messages = await searchMessages(channelId, filter, 0, 10000, false);

      let removedCount = 0;
      for (const message of messages) {
        const deleted = await deleteMessage(channelId, message.messageId);
        if (deleted) removedCount++;
      }

      // Optionally clear statistics
      if (clearStatistics && removedCount > 0) {
        try {
          const pool = getPool();
          await pool.execute(
            `UPDATE ${statisticsTable(channelId)} SET
            RECEIVED = GREATEST(RECEIVED - ?, 0)`,
            [removedCount]
          );
        } catch {
          // Statistics table might not exist
        }
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Remove messages error', error as Error);
      res.status(500).json({ error: 'Failed to remove messages' });
    }
  }
);

// ============================================================================
// Routes - Multipart Import (Phase 2)
// ============================================================================

/**
 * POST /channels/:channelId/messages/_importMultipart
 * Import a message from multipart form data
 */
messageRouter.post(
  '/_importMultipart',
  authorize({ operation: MESSAGE_IMPORT_MULTIPART, checkAuthorizedChannelId: 'channelId' }),
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);

      // Validate message tables exist
      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({
          error: 'Channel not found',
          message: 'Channel message tables do not exist',
        });
        return;
      }

      // Check for uploaded file
      if (!req.file) {
        res.status(400).json({
          error: 'No file uploaded',
          message: 'Request must include a file in multipart form data',
        });
        return;
      }

      // Parse the file content as JSON
      let importedMessage: {
        messageId?: number;
        serverId?: string;
        receivedDate?: string;
        processed?: boolean;
        connectorMessages?: Record<
          number,
          {
            metaDataId: number;
            connectorName: string;
            status: string;
            content?: Record<number, { contentType: number; content: string; dataType: string }>;
          }
        >;
      };

      try {
        importedMessage = JSON.parse(req.file.buffer.toString('utf8'));
      } catch {
        res.status(400).json({
          error: 'Invalid file format',
          message: 'File must contain valid JSON',
        });
        return;
      }

      if (!importedMessage || !importedMessage.connectorMessages) {
        res.status(400).json({
          error: 'Invalid message format',
          message: 'Message must contain connectorMessages',
        });
        return;
      }

      const pool = getPool();

      // Get next message ID
      const seqTable = `${sequenceTable(channelId)}`;
      const [seqRows] = await pool.query<RowDataPacket[]>(`SELECT ID FROM ${seqTable} FOR UPDATE`);
      const nextId = (seqRows[0]?.ID ?? 0) + 1;
      await pool.execute(`UPDATE ${seqTable} SET ID = ?`, [nextId]);

      // Insert message
      const receivedDate = importedMessage.receivedDate
        ? new Date(importedMessage.receivedDate)
        : new Date();

      await pool.execute(
        `INSERT INTO ${messageTable(channelId)}
         (ID, SERVER_ID, RECEIVED_DATE, PROCESSED, IMPORT_ID)
         VALUES (?, ?, ?, ?, ?)`,
        [
          nextId,
          importedMessage.serverId ?? 'import',
          receivedDate,
          importedMessage.processed ? 1 : 0,
          importedMessage.messageId ?? null,
        ]
      );

      // Insert connector messages and content
      for (const [metaDataIdStr, connectorMsg] of Object.entries(
        importedMessage.connectorMessages
      )) {
        const metaDataId = parseInt(metaDataIdStr, 10);

        await pool.execute(
          `INSERT INTO ${connectorMessageTable(channelId)}
           (MESSAGE_ID, METADATA_ID, CONNECTOR_NAME, RECEIVED_DATE, STATUS)
           VALUES (?, ?, ?, ?, ?)`,
          [nextId, metaDataId, connectorMsg.connectorName, receivedDate, connectorMsg.status]
        );

        // Insert content
        if (connectorMsg.content) {
          for (const [contentTypeStr, content] of Object.entries(connectorMsg.content)) {
            const contentType = parseInt(contentTypeStr, 10);
            await pool.execute(
              `INSERT INTO ${contentTable(channelId)}
               (MESSAGE_ID, METADATA_ID, CONTENT_TYPE, CONTENT, DATA_TYPE, IS_ENCRYPTED)
               VALUES (?, ?, ?, ?, ?, 0)`,
              [nextId, metaDataId, contentType, content.content, content.dataType]
            );
          }
        }
      }

      res.sendData({
        imported: true,
        messageId: nextId,
        originalId: importedMessage.messageId,
        filename: req.file.originalname,
      });
    } catch (error) {
      logger.error('Import message multipart error', error as Error);
      res.status(500).json({ error: 'Failed to import message' });
    }
  }
);

// ============================================================================
// Routes - Encrypted Export (Phase 2)
// ============================================================================

/**
 * Encrypt data using AES-256-GCM
 */
function encryptData(data: Buffer, key: string): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
  // Derive a 32-byte key from the provided key using SHA-256
  const derivedKey = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(12); // GCM recommended IV length

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { encrypted, iv, tag };
}

/**
 * POST /channels/:channelId/messages/_exportEncrypted
 * Export messages with optional encryption
 */
messageRouter.post(
  '/_exportEncrypted',
  authorize({ operation: MESSAGE_EXPORT_ENCRYPTED, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const filter = parseMessageFilter(req.body as Record<string, unknown>);
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 100;
      const encryptionKey = req.query.encryptionKey as string | undefined;

      // Get messages to export
      const messages = await searchMessages(channelId, filter, 0, pageSize, true);

      // Convert to JSON
      const jsonData = JSON.stringify(messages, null, 2);
      const dataBuffer = Buffer.from(jsonData, 'utf8');

      if (encryptionKey) {
        // Encrypt the data
        const { encrypted, iv, tag } = encryptData(dataBuffer, encryptionKey);

        // Create an archive format with metadata
        const archive = {
          format: 'mirth-encrypted-v1',
          algorithm: 'aes-256-gcm',
          iv: iv.toString('base64'),
          tag: tag.toString('base64'),
          data: encrypted.toString('base64'),
          messageCount: messages.length,
          channelId,
          exportedAt: new Date().toISOString(),
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="messages-encrypted.json"');
        res.json(archive);
      } else {
        // Return unencrypted
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="messages.json"');
        res.json(messages);
      }
    } catch (error) {
      logger.error('Export encrypted messages error', error as Error);
      res.status(500).json({ error: 'Failed to export messages' });
    }
  }
);

// ============================================================================
// Routes - Attachment CRUD (Phase 2)
// ============================================================================

/**
 * POST /channels/:channelId/messages/:messageId/attachments
 * Create a new attachment
 */
messageRouter.post(
  '/:messageId/attachments',
  authorize({ operation: MESSAGE_CREATE_ATTACHMENT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const messageIdStr = req.params.messageId as string;
      const messageId = parseInt(messageIdStr, 10);

      if (isNaN(messageId)) {
        res.status(400).json({ error: 'Invalid message ID' });
        return;
      }

      // Validate message tables exist
      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      // Verify message exists
      const message = await getMessage(channelId, messageId, false);
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      // Extract attachment data from request
      const { id, type, content } = req.body as {
        id?: string;
        type?: string;
        content: string; // Base64 encoded
      };

      if (!content) {
        res.status(400).json({
          error: 'Missing content',
          message: 'Attachment content is required (base64 encoded)',
        });
        return;
      }

      const attachmentId = id ?? crypto.randomUUID();
      const attachmentType = type ?? 'application/octet-stream';

      // Decode base64 content
      const data = Buffer.from(content, 'base64');

      const pool = getPool();

      // Insert attachment (single segment for simplicity)
      await pool.execute(
        `INSERT INTO ${attachmentTable(channelId)}
         (ID, MESSAGE_ID, TYPE, SEGMENT_ID, ATTACHMENT)
         VALUES (?, ?, ?, 0, ?)`,
        [attachmentId, messageId, attachmentType, data]
      );

      res.status(201).sendData({
        id: attachmentId,
        messageId,
        type: attachmentType,
        size: data.length,
      });
    } catch (error) {
      logger.error('Create attachment error', error as Error);
      res.status(500).json({ error: 'Failed to create attachment' });
    }
  }
);

/**
 * PUT /channels/:channelId/messages/:messageId/attachments/:attachmentId
 * Update an existing attachment
 */
messageRouter.put(
  '/:messageId/attachments/:attachmentId',
  authorize({ operation: MESSAGE_UPDATE_ATTACHMENT, checkAuthorizedChannelId: 'channelId' }),
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

      // Validate message tables exist
      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      // Check if attachment exists
      const existingAttachment = await getAttachment(channelId, messageId, attachmentId);
      if (!existingAttachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      // Extract new data from request
      const { type, content } = req.body as {
        type?: string;
        content: string; // Base64 encoded
      };

      if (!content) {
        res.status(400).json({
          error: 'Missing content',
          message: 'Attachment content is required (base64 encoded)',
        });
        return;
      }

      // Decode base64 content
      const data = Buffer.from(content, 'base64');
      const attachmentType = type ?? 'application/octet-stream';

      const pool = getPool();

      // Delete existing segments
      await pool.execute(
        `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ? AND ID = ?`,
        [messageId, attachmentId]
      );

      // Insert updated attachment
      await pool.execute(
        `INSERT INTO ${attachmentTable(channelId)}
         (ID, MESSAGE_ID, TYPE, SEGMENT_ID, ATTACHMENT)
         VALUES (?, ?, ?, 0, ?)`,
        [attachmentId, messageId, attachmentType, data]
      );

      res.sendData({
        id: attachmentId,
        messageId,
        type: attachmentType,
        size: data.length,
      });
    } catch (error) {
      logger.error('Update attachment error', error as Error);
      res.status(500).json({ error: 'Failed to update attachment' });
    }
  }
);

/**
 * DELETE /channels/:channelId/messages/:messageId/attachments/:attachmentId
 * Delete an attachment
 */
messageRouter.delete(
  '/:messageId/attachments/:attachmentId',
  authorize({ operation: MESSAGE_DELETE_ATTACHMENT, checkAuthorizedChannelId: 'channelId' }),
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

      // Validate message tables exist
      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      const pool = getPool();

      // Delete attachment
      const [result] = await pool.execute(
        `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ? AND ID = ?`,
        [messageId, attachmentId]
      );

      if ((result as { affectedRows: number }).affectedRows === 0) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Delete attachment error', error as Error);
      res.status(500).json({ error: 'Failed to delete attachment' });
    }
  }
);

// ============================================================================
// Routes - Bulk Reprocess with Connector Filtering (Phase 2)
// ============================================================================

/**
 * POST /channels/:channelId/messages/_reprocessBulk
 * Reprocess multiple messages by ID with optional connector filtering
 */
messageRouter.post(
  '/_reprocessBulk',
  authorize({ operation: MESSAGE_REPROCESS_BULK, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const { messageIds, destinationMetaDataIds } = req.body as {
        messageIds: number[];
        destinationMetaDataIds?: number[];
      };

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'messageIds must be a non-empty array',
        });
        return;
      }

      // Check if channel is deployed
      if (!EngineController.isDeployed(channelId)) {
        res.status(400).json({
          error: 'Channel not deployed',
          message: 'Channel must be deployed to reprocess messages',
        });
        return;
      }

      const replace = req.query.replace === 'true';
      const filterDestinations = destinationMetaDataIds && destinationMetaDataIds.length > 0;

      // Reprocess each message
      const results: Array<{
        originalId: number;
        newMessageId: number;
        success: boolean;
        error?: string;
      }> = [];

      for (const messageId of messageIds) {
        try {
          // Get the message with content
          const message = await getMessage(channelId, messageId, true);

          if (!message) {
            results.push({
              originalId: messageId,
              newMessageId: 0,
              success: false,
              error: 'Message not found',
            });
            continue;
          }

          // Get the original raw content from connector message 0 (source)
          const sourceConnector = message.connectorMessages[0];
          const rawContent = sourceConnector?.content?.[1]?.content ?? ''; // ContentType.RAW = 1

          if (!rawContent) {
            results.push({
              originalId: messageId,
              newMessageId: 0,
              success: false,
              error: 'No raw content to reprocess',
            });
            continue;
          }

          // Create source map with reprocessing metadata
          const sourceMap = new Map<string, unknown>();
          sourceMap.set('reprocessed', true);
          sourceMap.set('originalMessageId', messageId);

          if (replace) {
            sourceMap.set('replaceMessage', true);
          }

          if (filterDestinations && destinationMetaDataIds) {
            sourceMap.set('destinationMetaDataIds', destinationMetaDataIds);
            sourceMap.set('filterDestinations', true);
          }

          // Dispatch the message
          const result = await EngineController.dispatchMessage(channelId, rawContent, sourceMap);

          results.push({
            originalId: messageId,
            newMessageId: result.messageId,
            success: true,
          });
        } catch (error) {
          results.push({
            originalId: messageId,
            newMessageId: 0,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      res.sendData({
        reprocessed: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        total: messageIds.length,
        destinationMetaDataIds: filterDestinations ? destinationMetaDataIds : null,
        results,
      });
    } catch (error) {
      logger.error('Bulk reprocess messages error', error as Error);
      res.status(500).json({ error: 'Failed to reprocess messages' });
    }
  }
);

// ============================================================================
// Routes - Message Content Operations (Phase 2)
// ============================================================================

/**
 * GET /channels/:channelId/messages/:messageId/connectorMessages/:metaDataId/content/:contentType
 * Get specific content for a connector message
 */
messageRouter.get(
  '/:messageId/connectorMessages/:metaDataId/content/:contentType',
  authorize({ operation: MESSAGE_GET_CONTENT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const messageIdStr = req.params.messageId as string;
      const metaDataIdStr = req.params.metaDataId as string;
      const contentTypeStr = req.params.contentType as string;

      const messageId = parseInt(messageIdStr, 10);
      const metaDataId = parseInt(metaDataIdStr, 10);

      if (isNaN(messageId) || isNaN(metaDataId)) {
        res.status(400).json({ error: 'Invalid message ID or metadata ID' });
        return;
      }

      // Map content type string to number if needed
      let contentTypeNum: number;
      if (/^\d+$/.test(contentTypeStr)) {
        contentTypeNum = parseInt(contentTypeStr, 10);
      } else {
        // Map string names to ContentType enum values
        const contentTypeMap: Record<string, number> = {
          RAW: 1,
          PROCESSED_RAW: 2,
          TRANSFORMED: 3,
          ENCODED: 4,
          SENT: 5,
          RESPONSE: 6,
          RESPONSE_TRANSFORMED: 7,
          PROCESSED_RESPONSE: 8,
          CONNECTOR_MAP: 9,
          CHANNEL_MAP: 10,
          RESPONSE_MAP: 11,
          PROCESSING_ERROR: 12,
          POSTPROCESSOR_ERROR: 13,
          RESPONSE_ERROR: 14,
          SOURCE_MAP: 15,
        };
        contentTypeNum = contentTypeMap[contentTypeStr.toUpperCase()] ?? -1;
      }

      if (contentTypeNum < 0) {
        res.status(400).json({ error: 'Invalid content type' });
        return;
      }

      // Validate message tables exist
      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      const pool = getPool();

      // Get the specific content
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT CONTENT, DATA_TYPE, IS_ENCRYPTED
         FROM ${contentTable(channelId)}
         WHERE MESSAGE_ID = ? AND METADATA_ID = ? AND CONTENT_TYPE = ?`,
        [messageId, metaDataId, contentTypeNum]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: 'Content not found' });
        return;
      }

      const row = rows[0]!;
      res.sendData({
        messageId,
        metaDataId,
        contentType: contentTypeNum,
        content: row.CONTENT,
        dataType: row.DATA_TYPE,
        encrypted: row.IS_ENCRYPTED === 1,
      });
    } catch (error) {
      logger.error('Get content error', error as Error);
      res.status(500).json({ error: 'Failed to get content' });
    }
  }
);

/**
 * PUT /channels/:channelId/messages/:messageId/connectorMessages/:metaDataId/content/:contentType
 * Update specific content for a connector message
 */
messageRouter.put(
  '/:messageId/connectorMessages/:metaDataId/content/:contentType',
  authorize({ operation: MESSAGE_UPDATE_CONTENT, checkAuthorizedChannelId: 'channelId' }),
  async (req: Request, res: Response) => {
    try {
      const channelId = getChannelId(req);
      const messageIdStr = req.params.messageId as string;
      const metaDataIdStr = req.params.metaDataId as string;
      const contentTypeStr = req.params.contentType as string;

      const messageId = parseInt(messageIdStr, 10);
      const metaDataId = parseInt(metaDataIdStr, 10);

      if (isNaN(messageId) || isNaN(metaDataId)) {
        res.status(400).json({ error: 'Invalid message ID or metadata ID' });
        return;
      }

      // Map content type string to number if needed
      let contentTypeNum: number;
      if (/^\d+$/.test(contentTypeStr)) {
        contentTypeNum = parseInt(contentTypeStr, 10);
      } else {
        const contentTypeMap: Record<string, number> = {
          RAW: 1,
          PROCESSED_RAW: 2,
          TRANSFORMED: 3,
          ENCODED: 4,
          SENT: 5,
          RESPONSE: 6,
          RESPONSE_TRANSFORMED: 7,
          PROCESSED_RESPONSE: 8,
          CONNECTOR_MAP: 9,
          CHANNEL_MAP: 10,
          RESPONSE_MAP: 11,
          PROCESSING_ERROR: 12,
          POSTPROCESSOR_ERROR: 13,
          RESPONSE_ERROR: 14,
          SOURCE_MAP: 15,
        };
        contentTypeNum = contentTypeMap[contentTypeStr.toUpperCase()] ?? -1;
      }

      if (contentTypeNum < 0) {
        res.status(400).json({ error: 'Invalid content type' });
        return;
      }

      // Validate message tables exist
      const exists = await messageTablesExist(channelId);
      if (!exists) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      const { content, dataType } = req.body as {
        content: string;
        dataType?: string;
      };

      if (content === undefined) {
        res.status(400).json({
          error: 'Missing content',
          message: 'Content is required in request body',
        });
        return;
      }

      const pool = getPool();

      // Check if content exists
      const [existingRows] = await pool.query<RowDataPacket[]>(
        `SELECT 1 FROM ${contentTable(channelId)}
         WHERE MESSAGE_ID = ? AND METADATA_ID = ? AND CONTENT_TYPE = ?`,
        [messageId, metaDataId, contentTypeNum]
      );

      if (existingRows.length === 0) {
        // Insert new content
        await pool.execute(
          `INSERT INTO ${contentTable(channelId)}
           (MESSAGE_ID, METADATA_ID, CONTENT_TYPE, CONTENT, DATA_TYPE, IS_ENCRYPTED)
           VALUES (?, ?, ?, ?, ?, 0)`,
          [messageId, metaDataId, contentTypeNum, content, dataType ?? 'HL7V2']
        );
      } else {
        // Update existing content
        await pool.execute(
          `UPDATE ${contentTable(channelId)}
           SET CONTENT = ?, DATA_TYPE = ?
           WHERE MESSAGE_ID = ? AND METADATA_ID = ? AND CONTENT_TYPE = ?`,
          [content, dataType ?? 'HL7V2', messageId, metaDataId, contentTypeNum]
        );
      }

      res.sendData({
        messageId,
        metaDataId,
        contentType: contentTypeNum,
        updated: true,
      });
    } catch (error) {
      logger.error('Update content error', error as Error);
      res.status(500).json({ error: 'Failed to update content' });
    }
  }
);
