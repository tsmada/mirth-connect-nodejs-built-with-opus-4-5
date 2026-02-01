/**
 * Data Access Object for Donkey message tables
 *
 * Dynamic per-channel tables:
 * - D_M{channelId} - Messages
 * - D_MM{channelId} - Connector messages (metadata)
 * - D_MC{channelId} - Message content
 * - D_MA{channelId} - Message attachments
 * - D_MS{channelId} - Message statistics
 * - D_MSQ{channelId} - Message sequence
 *
 * Reference: ~/Projects/connect/donkey/donkeydbconf/mysql.xml
 */

import { RowDataPacket } from 'mysql2/promise';
import { getPool, transaction } from './pool.js';
import { Status } from '../model/Status.js';
import { ContentType } from '../model/ContentType.js';

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

function statisticsTable(channelId: string): string {
  return `D_MS${channelId.replace(/-/g, '_')}`;
}

function sequenceTable(channelId: string): string {
  return `D_MSQ${channelId.replace(/-/g, '_')}`;
}

// Row interfaces
export interface MessageRow extends RowDataPacket {
  ID: number;
  SERVER_ID: string;
  RECEIVED_DATE: Date;
  PROCESSED: number;
  ORIGINAL_ID: number | null;
  IMPORT_ID: number | null;
  IMPORT_CHANNEL_ID: string | null;
}

export interface ConnectorMessageRow extends RowDataPacket {
  MESSAGE_ID: number;
  METADATA_ID: number;
  RECEIVED_DATE: Date;
  STATUS: string;
  CONNECTOR_NAME: string;
  SEND_ATTEMPTS: number;
  SEND_DATE: Date | null;
  RESPONSE_DATE: Date | null;
  ERROR_CODE: number | null;
  CHAIN_ID: number;
  ORDER_ID: number;
}

export interface ContentRow extends RowDataPacket {
  MESSAGE_ID: number;
  METADATA_ID: number;
  CONTENT_TYPE: number;
  CONTENT: string;
  DATA_TYPE: string;
  IS_ENCRYPTED: number;
}

/**
 * Create message tables for a channel
 */
export async function createChannelTables(channelId: string): Promise<void> {
  await transaction(async (connection) => {
    // D_M - Messages table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${messageTable(channelId)} (
        ID BIGINT NOT NULL,
        SERVER_ID VARCHAR(36) NOT NULL,
        RECEIVED_DATE DATETIME(3) NOT NULL,
        PROCESSED TINYINT(1) NOT NULL DEFAULT 0,
        ORIGINAL_ID BIGINT,
        IMPORT_ID BIGINT,
        IMPORT_CHANNEL_ID VARCHAR(36),
        PRIMARY KEY (ID)
      )
    `);

    // D_MM - Connector messages table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${connectorMessageTable(channelId)} (
        MESSAGE_ID BIGINT NOT NULL,
        METADATA_ID INT NOT NULL,
        RECEIVED_DATE DATETIME(3) NOT NULL,
        STATUS CHAR(1) NOT NULL,
        CONNECTOR_NAME VARCHAR(255),
        SEND_ATTEMPTS INT NOT NULL DEFAULT 0,
        SEND_DATE DATETIME(3),
        RESPONSE_DATE DATETIME(3),
        ERROR_CODE INT,
        CHAIN_ID INT NOT NULL DEFAULT 0,
        ORDER_ID INT NOT NULL DEFAULT 0,
        PRIMARY KEY (MESSAGE_ID, METADATA_ID)
      )
    `);

    // D_MC - Message content table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${contentTable(channelId)} (
        MESSAGE_ID BIGINT NOT NULL,
        METADATA_ID INT NOT NULL,
        CONTENT_TYPE INT NOT NULL,
        CONTENT LONGTEXT,
        DATA_TYPE VARCHAR(255),
        IS_ENCRYPTED TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (MESSAGE_ID, METADATA_ID, CONTENT_TYPE)
      )
    `);

    // D_MA - Attachments table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${attachmentTable(channelId)} (
        ID VARCHAR(36) NOT NULL,
        MESSAGE_ID BIGINT NOT NULL,
        TYPE VARCHAR(255),
        SEGMENT_ID INT NOT NULL DEFAULT 0,
        ATTACHMENT LONGBLOB,
        PRIMARY KEY (ID, MESSAGE_ID, SEGMENT_ID)
      )
    `);

    // D_MS - Statistics table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${statisticsTable(channelId)} (
        METADATA_ID INT NOT NULL,
        SERVER_ID VARCHAR(36) NOT NULL,
        RECEIVED BIGINT NOT NULL DEFAULT 0,
        FILTERED BIGINT NOT NULL DEFAULT 0,
        TRANSFORMED BIGINT NOT NULL DEFAULT 0,
        PENDING BIGINT NOT NULL DEFAULT 0,
        SENT BIGINT NOT NULL DEFAULT 0,
        ERROR BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (METADATA_ID, SERVER_ID)
      )
    `);

    // D_MSQ - Sequence table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${sequenceTable(channelId)} (
        ID BIGINT NOT NULL DEFAULT 1,
        LOCAL_CHANNEL_ID BIGINT NOT NULL DEFAULT 1,
        PRIMARY KEY (ID)
      )
    `);

    // Initialize sequence
    await connection.query(`
      INSERT IGNORE INTO ${sequenceTable(channelId)} (ID, LOCAL_CHANNEL_ID) VALUES (1, 1)
    `);
  });
}

/**
 * Drop message tables for a channel
 */
export async function dropChannelTables(channelId: string): Promise<void> {
  await transaction(async (connection) => {
    await connection.query(`DROP TABLE IF EXISTS ${messageTable(channelId)}`);
    await connection.query(`DROP TABLE IF EXISTS ${connectorMessageTable(channelId)}`);
    await connection.query(`DROP TABLE IF EXISTS ${contentTable(channelId)}`);
    await connection.query(`DROP TABLE IF EXISTS ${attachmentTable(channelId)}`);
    await connection.query(`DROP TABLE IF EXISTS ${statisticsTable(channelId)}`);
    await connection.query(`DROP TABLE IF EXISTS ${sequenceTable(channelId)}`);
  });
}

/**
 * Get next message ID for a channel
 */
export async function getNextMessageId(channelId: string): Promise<number> {
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Get and increment sequence
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT LOCAL_CHANNEL_ID FROM ${sequenceTable(channelId)} WHERE ID = 1 FOR UPDATE`
    );

    const currentId = (rows[0]?.LOCAL_CHANNEL_ID as number) ?? 1;
    const nextId = currentId + 1;

    await connection.query(
      `UPDATE ${sequenceTable(channelId)} SET LOCAL_CHANNEL_ID = ? WHERE ID = 1`,
      [nextId]
    );

    await connection.commit();
    return currentId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Insert a message
 */
export async function insertMessage(
  channelId: string,
  messageId: number,
  serverId: string,
  receivedDate: Date
): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO ${messageTable(channelId)} (ID, SERVER_ID, RECEIVED_DATE, PROCESSED)
     VALUES (?, ?, ?, 0)`,
    [messageId, serverId, receivedDate]
  );
}

/**
 * Update message processed status
 */
export async function updateMessageProcessed(
  channelId: string,
  messageId: number,
  processed: boolean
): Promise<void> {
  const pool = getPool();
  await pool.execute(`UPDATE ${messageTable(channelId)} SET PROCESSED = ? WHERE ID = ?`, [
    processed ? 1 : 0,
    messageId,
  ]);
}

/**
 * Insert a connector message
 */
export async function insertConnectorMessage(
  channelId: string,
  messageId: number,
  metaDataId: number,
  connectorName: string,
  receivedDate: Date,
  status: Status
): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO ${connectorMessageTable(channelId)}
     (MESSAGE_ID, METADATA_ID, RECEIVED_DATE, STATUS, CONNECTOR_NAME, SEND_ATTEMPTS, CHAIN_ID, ORDER_ID)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
    [messageId, metaDataId, receivedDate, status, connectorName, metaDataId]
  );
}

/**
 * Update connector message status
 */
export async function updateConnectorMessageStatus(
  channelId: string,
  messageId: number,
  metaDataId: number,
  status: Status
): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `UPDATE ${connectorMessageTable(channelId)} SET STATUS = ? WHERE MESSAGE_ID = ? AND METADATA_ID = ?`,
    [status, messageId, metaDataId]
  );
}

/**
 * Insert message content
 */
export async function insertContent(
  channelId: string,
  messageId: number,
  metaDataId: number,
  contentType: ContentType,
  content: string,
  dataType: string,
  encrypted: boolean
): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO ${contentTable(channelId)}
     (MESSAGE_ID, METADATA_ID, CONTENT_TYPE, CONTENT, DATA_TYPE, IS_ENCRYPTED)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [messageId, metaDataId, contentType, content, dataType, encrypted ? 1 : 0]
  );
}

/**
 * Get message content
 */
export async function getContent(
  channelId: string,
  messageId: number,
  metaDataId: number,
  contentType: ContentType
): Promise<ContentRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<ContentRow[]>(
    `SELECT * FROM ${contentTable(channelId)}
     WHERE MESSAGE_ID = ? AND METADATA_ID = ? AND CONTENT_TYPE = ?`,
    [messageId, metaDataId, contentType]
  );
  return rows[0] ?? null;
}

/**
 * Get message by ID
 */
export async function getMessage(channelId: string, messageId: number): Promise<MessageRow | null> {
  const pool = getPool();
  const [rows] = await pool.query<MessageRow[]>(
    `SELECT * FROM ${messageTable(channelId)} WHERE ID = ?`,
    [messageId]
  );
  return rows[0] ?? null;
}

/**
 * Get connector messages for a message
 */
export async function getConnectorMessages(
  channelId: string,
  messageId: number
): Promise<ConnectorMessageRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<ConnectorMessageRow[]>(
    `SELECT * FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID = ? ORDER BY METADATA_ID`,
    [messageId]
  );
  return rows;
}

/**
 * Update statistics for a connector
 */
export async function updateStatistics(
  channelId: string,
  metaDataId: number,
  serverId: string,
  status: Status,
  increment: number = 1
): Promise<void> {
  const statusColumn = status.toLowerCase();
  const pool = getPool();

  await pool.execute(
    `INSERT INTO ${statisticsTable(channelId)} (METADATA_ID, SERVER_ID, ${statusColumn})
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE ${statusColumn} = ${statusColumn} + ?`,
    [metaDataId, serverId, increment, increment]
  );
}

/**
 * Get statistics for a channel
 */
export async function getStatistics(channelId: string): Promise<RowDataPacket[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${statisticsTable(channelId)}`);
  return rows;
}

// ============================================================================
// Data Pruner Methods
// ============================================================================

/**
 * Row interface for channel mapping
 */
export interface ChannelMappingRow extends RowDataPacket {
  CHANNEL_ID: string;
  LOCAL_CHANNEL_ID: number;
}

/**
 * Row interface for messages to prune
 */
export interface PruneMessageRow extends RowDataPacket {
  messageId: number;
  receivedDate: Date;
}

/**
 * Get all local channel IDs (channel UUID to local numeric ID mapping)
 * In our implementation, we use UUIDs directly for table names, so this
 * returns a map of channelId -> channelId for channels that have tables.
 */
export async function getLocalChannelIds(): Promise<Map<string, number>> {
  const pool = getPool();
  const channelMap = new Map<string, number>();

  // Query the D_CHANNELS table if it exists, otherwise check information_schema
  try {
    const [rows] = await pool.query<ChannelMappingRow[]>(
      `SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS`
    );
    for (const row of rows) {
      channelMap.set(row.CHANNEL_ID, row.LOCAL_CHANNEL_ID);
    }
  } catch {
    // If D_CHANNELS doesn't exist, scan for message tables
    const [tables] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'D\\_M%' AND TABLE_NAME NOT LIKE 'D\\_MM%'
       AND TABLE_NAME NOT LIKE 'D\\_MC%' AND TABLE_NAME NOT LIKE 'D\\_MA%'
       AND TABLE_NAME NOT LIKE 'D\\_MS%'`
    );

    let localId = 1;
    for (const row of tables) {
      const tableName = row.TABLE_NAME as string;
      // Extract channel ID from table name (D_M{uuid_with_underscores})
      const channelId = tableName.substring(3).replace(/_/g, '-');
      channelMap.set(channelId, localId++);
    }
  }

  return channelMap;
}

/**
 * Get the local channel ID for a specific channel
 */
export async function getLocalChannelId(channelId: string): Promise<number | null> {
  const channelMap = await getLocalChannelIds();
  return channelMap.get(channelId) ?? null;
}

/**
 * Check if message tables exist for a channel
 */
export async function channelTablesExist(channelId: string): Promise<boolean> {
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
 * Get messages to prune based on date threshold
 */
export async function getMessagesToPrune(
  channelId: string,
  dateThreshold: Date,
  limit: number,
  skipStatuses?: string[]
): Promise<PruneMessageRow[]> {
  const pool = getPool();

  // Build the query with optional status filtering
  let query = `
    SELECT m.ID as messageId, m.RECEIVED_DATE as receivedDate
    FROM ${messageTable(channelId)} m
    WHERE m.RECEIVED_DATE < ?
  `;

  const params: (Date | string | number)[] = [dateThreshold];

  // Skip messages with certain statuses (check connector messages)
  if (skipStatuses && skipStatuses.length > 0) {
    query += `
      AND NOT EXISTS (
        SELECT 1 FROM ${connectorMessageTable(channelId)} mm
        WHERE mm.MESSAGE_ID = m.ID AND mm.STATUS IN (${skipStatuses.map(() => '?').join(', ')})
      )
    `;
    params.push(...skipStatuses);
  }

  query += ` ORDER BY m.RECEIVED_DATE ASC LIMIT ?`;
  params.push(limit);

  const [rows] = await pool.query<PruneMessageRow[]>(query, params);
  return rows;
}

/**
 * Prune message content for specified messages
 * Returns the number of content rows deleted
 */
export async function pruneMessageContent(
  channelId: string,
  messageIds: number[]
): Promise<number> {
  if (messageIds.length === 0) {
    return 0;
  }

  const pool = getPool();
  const placeholders = messageIds.map(() => '?').join(', ');

  const [result] = await pool.execute(
    `DELETE FROM ${contentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
    messageIds
  );

  return (result as { affectedRows: number }).affectedRows;
}

/**
 * Prune attachments for specified messages
 * Returns the number of attachment rows deleted
 */
export async function pruneMessageAttachments(
  channelId: string,
  messageIds: number[]
): Promise<number> {
  if (messageIds.length === 0) {
    return 0;
  }

  const pool = getPool();
  const placeholders = messageIds.map(() => '?').join(', ');

  const [result] = await pool.execute(
    `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
    messageIds
  );

  return (result as { affectedRows: number }).affectedRows;
}

/**
 * Prune connector messages (metadata) for specified messages
 * Returns the number of connector message rows deleted
 */
export async function pruneConnectorMessages(
  channelId: string,
  messageIds: number[]
): Promise<number> {
  if (messageIds.length === 0) {
    return 0;
  }

  const pool = getPool();
  const placeholders = messageIds.map(() => '?').join(', ');

  const [result] = await pool.execute(
    `DELETE FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
    messageIds
  );

  return (result as { affectedRows: number }).affectedRows;
}

/**
 * Prune messages (full deletion including metadata)
 * Returns the number of messages deleted
 */
export async function pruneMessages(channelId: string, messageIds: number[]): Promise<number> {
  if (messageIds.length === 0) {
    return 0;
  }

  return await transaction(async (connection) => {
    const placeholders = messageIds.map(() => '?').join(', ');

    // Delete in order: content, attachments, connector messages, messages
    await connection.execute(
      `DELETE FROM ${contentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
      messageIds
    );

    await connection.execute(
      `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
      messageIds
    );

    await connection.execute(
      `DELETE FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
      messageIds
    );

    const [result] = await connection.execute(
      `DELETE FROM ${messageTable(channelId)} WHERE ID IN (${placeholders})`,
      messageIds
    );

    return (result as { affectedRows: number }).affectedRows;
  });
}

/**
 * Get count of messages before a date threshold
 */
export async function getMessageCountBeforeDate(
  channelId: string,
  dateThreshold: Date
): Promise<number> {
  const pool = getPool();

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM ${messageTable(channelId)} WHERE RECEIVED_DATE < ?`,
    [dateThreshold]
  );

  return rows[0]?.count ?? 0;
}
