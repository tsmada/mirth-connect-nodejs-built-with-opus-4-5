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

import { RowDataPacket, Pool, PoolConnection } from 'mysql2/promise';
import { getPool, transaction } from './pool.js';
import { Status, parseStatus } from '../model/Status.js';
import { ContentType } from '../model/ContentType.js';
import { getEncryptor, isEncryptionEnabled } from './Encryptor.js';
import { getLogger, registerComponent } from '../logging/index.js';

registerComponent('database', 'DB pool/queries');
const logger = getLogger('database');

export type DbConnection = Pool | PoolConnection;

/**
 * Map Status enum values to D_MS statistics table column names.
 * D_MS columns: RECEIVED, FILTERED, TRANSFORMED, PENDING, SENT, ERROR
 * Note: QUEUED maps to SENT (Java Mirth tracks queued under sent column).
 */
function statusToColumn(status: Status): string {
  switch (status) {
    case Status.RECEIVED:    return 'RECEIVED';
    case Status.FILTERED:    return 'FILTERED';
    case Status.TRANSFORMED: return 'TRANSFORMED';
    case Status.SENT:        return 'SENT';
    case Status.QUEUED:      return 'SENT';
    case Status.ERROR:       return 'ERROR';
    case Status.PENDING:     return 'PENDING';
    default:                 throw new Error(`Unknown status for statistics: ${status}`);
  }
}

// Channel ID validation — prevents SQL injection via table name interpolation.
// Accepts standard hex UUIDs and test IDs with alphanumeric segments (e.g. ks000001-...).
const UUID_PATTERN = /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/i;

export function validateChannelId(id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid channel ID format: ${id}`);
  }
  return id.replace(/-/g, '_');
}

// Table name helpers
export function messageTable(channelId: string): string {
  return `D_M${validateChannelId(channelId)}`;
}

export function connectorMessageTable(channelId: string): string {
  return `D_MM${validateChannelId(channelId)}`;
}

export function contentTable(channelId: string): string {
  return `D_MC${validateChannelId(channelId)}`;
}

export function attachmentTable(channelId: string): string {
  return `D_MA${validateChannelId(channelId)}`;
}

export function statisticsTable(channelId: string): string {
  return `D_MS${validateChannelId(channelId)}`;
}

export function sequenceTable(channelId: string): string {
  return `D_MSQ${validateChannelId(channelId)}`;
}

function customMetadataTable(channelId: string): string {
  return `D_MCM${validateChannelId(channelId)}`;
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

export interface StatisticsRow extends RowDataPacket {
  METADATA_ID: number;
  SERVER_ID: string;
  RECEIVED: number;
  FILTERED: number;
  TRANSFORMED: number;
  PENDING: number;
  SENT: number;
  ERROR: number;
}

/**
 * Register a channel in D_CHANNELS table and get its local ID
 * Creates D_CHANNELS table if needed
 */
export async function registerChannel(channelId: string): Promise<number> {
  const pool = getPool();

  // Ensure D_CHANNELS table exists
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_CHANNELS (
      LOCAL_CHANNEL_ID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      CHANNEL_ID VARCHAR(36) NOT NULL UNIQUE
    ) ENGINE=InnoDB
  `);

  // Insert or get existing
  await pool.execute(`INSERT IGNORE INTO D_CHANNELS (CHANNEL_ID) VALUES (?)`, [channelId]);

  // Get the local ID
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID = ?`,
    [channelId]
  );

  return rows[0]!.LOCAL_CHANNEL_ID as number;
}

/**
 * Unregister a channel from D_CHANNELS table
 */
export async function unregisterChannel(channelId: string): Promise<void> {
  const pool = getPool();
  await pool.execute(`DELETE FROM D_CHANNELS WHERE CHANNEL_ID = ?`, [channelId]);
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

    // D_MCM - Custom metadata table (for user-defined message metadata columns)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${customMetadataTable(channelId)} (
        MESSAGE_ID BIGINT NOT NULL,
        METADATA_ID INT NOT NULL,
        PRIMARY KEY (MESSAGE_ID, METADATA_ID)
      )
    `);

    // Add indexes for common queries (ignore duplicate key errors)
    try {
      await connection.query(`
        CREATE INDEX IDX_MM_STATUS ON ${connectorMessageTable(channelId)} (STATUS)
      `);
    } catch {
      // Index may already exist
    }

    try {
      await connection.query(`
        CREATE INDEX IDX_M_RECEIVED ON ${messageTable(channelId)} (RECEIVED_DATE)
      `);
    } catch {
      // Index may already exist
    }

    try {
      await connection.query(`
        CREATE INDEX IDX_MC_TYPE ON ${contentTable(channelId)} (CONTENT_TYPE)
      `);
    } catch {
      // Index may already exist
    }
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
    await connection.query(`DROP TABLE IF EXISTS ${customMetadataTable(channelId)}`);
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
  receivedDate: Date,
  conn?: DbConnection
): Promise<void> {
  const db = conn ?? getPool();
  await db.execute(
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
  processed: boolean,
  conn?: DbConnection
): Promise<void> {
  const db = conn ?? getPool();
  await db.execute(`UPDATE ${messageTable(channelId)} SET PROCESSED = ? WHERE ID = ?`, [
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
  status: Status,
  chainId: number = 0,
  options?: {
    storeMaps?: { sourceMap?: Map<string, unknown>; connectorMap?: Map<string, unknown>; channelMap?: Map<string, unknown>; responseMap?: Map<string, unknown> };
    updateStats?: boolean;
    serverId?: string;
  },
  conn?: DbConnection
): Promise<void> {
  const db = conn ?? getPool();
  await db.execute(
    `INSERT INTO ${connectorMessageTable(channelId)}
     (MESSAGE_ID, METADATA_ID, RECEIVED_DATE, STATUS, CONNECTOR_NAME, SEND_ATTEMPTS, CHAIN_ID, ORDER_ID)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [messageId, metaDataId, receivedDate, status, connectorName, chainId, metaDataId]
  );

  // Write maps atomically with connector message insert
  if (options?.storeMaps) {
    const { sourceMap, connectorMap, channelMap, responseMap } = options.storeMaps;
    if (sourceMap && sourceMap.size > 0) {
      await storeContent(channelId, messageId, metaDataId, ContentType.SOURCE_MAP,
        JSON.stringify(Object.fromEntries(sourceMap)), 'JSON', false, conn);
    }
    if (connectorMap && connectorMap.size > 0) {
      await storeContent(channelId, messageId, metaDataId, ContentType.CONNECTOR_MAP,
        JSON.stringify(Object.fromEntries(connectorMap)), 'JSON', false, conn);
    }
    if (channelMap && channelMap.size > 0) {
      await storeContent(channelId, messageId, metaDataId, ContentType.CHANNEL_MAP,
        JSON.stringify(Object.fromEntries(channelMap)), 'JSON', false, conn);
    }
    if (responseMap && responseMap.size > 0) {
      await storeContent(channelId, messageId, metaDataId, ContentType.RESPONSE_MAP,
        JSON.stringify(Object.fromEntries(responseMap)), 'JSON', false, conn);
    }
  }

  // Update RECEIVED statistics atomically
  if (options?.updateStats && options.serverId) {
    await updateStatistics(channelId, metaDataId, options.serverId, Status.RECEIVED, 1, conn);
  }
}

/**
 * Update connector message status
 */
export async function updateConnectorMessageStatus(
  channelId: string,
  messageId: number,
  metaDataId: number,
  status: Status,
  conn?: DbConnection
): Promise<void> {
  const db = conn ?? getPool();
  await db.execute(
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
  encrypted: boolean,
  conn?: DbConnection
): Promise<void> {
  let finalContent = content;
  let finalEncrypted = encrypted;

  // Encrypt content if requested and encryption is configured
  if (encrypted && isEncryptionEnabled()) {
    finalContent = getEncryptor().encrypt(content);
  } else if (encrypted && !isEncryptionEnabled()) {
    // No encryptor configured — store as plaintext
    finalEncrypted = false;
  }

  const db = conn ?? getPool();
  await db.execute(
    `INSERT INTO ${contentTable(channelId)}
     (MESSAGE_ID, METADATA_ID, CONTENT_TYPE, CONTENT, DATA_TYPE, IS_ENCRYPTED)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [messageId, metaDataId, contentType, finalContent, dataType, finalEncrypted ? 1 : 0]
  );
}

/**
 * Store (upsert) message content — tries UPDATE first, falls back to INSERT.
 * Ported from JdbcDao.storeMessageContent() (lines 261-340).
 *
 * Used for content types that may already have a row (e.g., SENT on retry,
 * RESPONSE on re-send). The primary key is (MESSAGE_ID, METADATA_ID, CONTENT_TYPE).
 */
export async function storeContent(
  channelId: string,
  messageId: number,
  metaDataId: number,
  contentType: ContentType,
  content: string,
  dataType: string,
  encrypted: boolean,
  conn?: DbConnection
): Promise<void> {
  let finalContent = content;
  let finalEncrypted = encrypted;

  // Encrypt content if requested and encryption is configured
  if (encrypted && isEncryptionEnabled()) {
    finalContent = getEncryptor().encrypt(content);
  } else if (encrypted && !isEncryptionEnabled()) {
    finalEncrypted = false;
  }

  const db = conn ?? getPool();
  const [result] = await db.execute(
    `UPDATE ${contentTable(channelId)}
     SET CONTENT = ?, DATA_TYPE = ?, IS_ENCRYPTED = ?
     WHERE METADATA_ID = ? AND MESSAGE_ID = ? AND CONTENT_TYPE = ?`,
    [finalContent, dataType, finalEncrypted ? 1 : 0, metaDataId, messageId, contentType]
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    // Pass already-encrypted content with finalEncrypted=false to avoid double encryption in insertContent
    await db.execute(
      `INSERT INTO ${contentTable(channelId)}
       (MESSAGE_ID, METADATA_ID, CONTENT_TYPE, CONTENT, DATA_TYPE, IS_ENCRYPTED)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [messageId, metaDataId, contentType, finalContent, dataType, finalEncrypted ? 1 : 0]
    );
  }
}

/**
 * Batch insert multiple content rows in a single INSERT statement.
 * More efficient than individual inserts when writing multiple content types at once.
 */
export async function batchInsertContent(
  channelId: string,
  rows: Array<{ messageId: number; metaDataId: number; contentType: ContentType; content: string; dataType: string; encrypted: boolean }>,
  conn?: DbConnection
): Promise<void> {
  if (rows.length === 0) return;
  const db = conn ?? getPool();
  const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
  const values = rows.flatMap(r => [r.messageId, r.metaDataId, r.contentType, r.content, r.dataType, r.encrypted ? 1 : 0]);
  await db.execute(
    `INSERT INTO ${contentTable(channelId)} (MESSAGE_ID, METADATA_ID, CONTENT_TYPE, CONTENT, DATA_TYPE, IS_ENCRYPTED) VALUES ${placeholders}`,
    values
  );
}

/**
 * Persist processing error and postprocessor error content to D_MC.
 * Ported from JdbcDao.updateErrors() (lines 955-975).
 *
 * Also updates the ERROR_CODE column in D_MM if an error code is provided.
 */
export async function updateErrors(
  channelId: string,
  messageId: number,
  metaDataId: number,
  processingError?: string,
  postProcessorError?: string,
  errorCode?: number,
  responseError?: string,
  conn?: DbConnection
): Promise<void> {
  if (processingError) {
    await storeContent(channelId, messageId, metaDataId, ContentType.PROCESSING_ERROR,
      processingError, 'text/plain', false, conn);
  }
  if (postProcessorError) {
    await storeContent(channelId, messageId, metaDataId, ContentType.POSTPROCESSOR_ERROR,
      postProcessorError, 'text/plain', false, conn);
  }
  if (responseError) {
    await storeContent(channelId, messageId, metaDataId, ContentType.RESPONSE_ERROR,
      responseError, 'text/plain', false, conn);
  }
  if (errorCode !== undefined) {
    const db = conn ?? getPool();
    await db.execute(
      `UPDATE ${connectorMessageTable(channelId)} SET ERROR_CODE = ? WHERE MESSAGE_ID = ? AND METADATA_ID = ?`,
      [errorCode, messageId, metaDataId]
    );
  }
}

/**
 * Persist connector, channel, and response maps to D_MC.
 * Ported from JdbcDao.updateMaps() (lines 1016-1051).
 *
 * Each map is serialized as JSON and stored as the corresponding ContentType.
 */
export async function updateMaps(
  channelId: string,
  messageId: number,
  metaDataId: number,
  connectorMap?: Map<string, unknown>,
  channelMap?: Map<string, unknown>,
  responseMap?: Map<string, unknown>,
  conn?: DbConnection
): Promise<void> {
  if (connectorMap && connectorMap.size > 0) {
    await storeContent(channelId, messageId, metaDataId, ContentType.CONNECTOR_MAP,
      JSON.stringify(Object.fromEntries(connectorMap)), 'JSON', false, conn);
  }
  if (channelMap && channelMap.size > 0) {
    await storeContent(channelId, messageId, metaDataId, ContentType.CHANNEL_MAP,
      JSON.stringify(Object.fromEntries(channelMap)), 'JSON', false, conn);
  }
  if (responseMap && responseMap.size > 0) {
    await storeContent(channelId, messageId, metaDataId, ContentType.RESPONSE_MAP,
      JSON.stringify(Object.fromEntries(responseMap)), 'JSON', false, conn);
  }
}

/**
 * Persist only the response map to D_MC.
 * Ported from JdbcDao.updateResponseMap() (lines 1064-1068).
 */
export async function updateResponseMap(
  channelId: string,
  messageId: number,
  metaDataId: number,
  responseMap: Map<string, unknown>,
  conn?: DbConnection
): Promise<void> {
  if (responseMap.size > 0) {
    await storeContent(channelId, messageId, metaDataId, ContentType.RESPONSE_MAP,
      JSON.stringify(Object.fromEntries(responseMap)), 'JSON', false, conn);
  }
}

/**
 * Update send attempts, send date, and response date on a connector message.
 * Ported from JdbcDao.updateSendAttempts() (lines 172-193).
 */
export async function updateSendAttempts(
  channelId: string,
  messageId: number,
  metaDataId: number,
  sendAttempts: number,
  sendDate?: Date,
  responseDate?: Date,
  conn?: DbConnection
): Promise<void> {
  const db = conn ?? getPool();
  await db.execute(
    `UPDATE ${connectorMessageTable(channelId)}
     SET SEND_ATTEMPTS = ?, SEND_DATE = ?, RESPONSE_DATE = ?
     WHERE MESSAGE_ID = ? AND METADATA_ID = ?`,
    [sendAttempts, sendDate ?? null, responseDate ?? null, messageId, metaDataId]
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
  const row = rows[0] ?? null;

  // Decrypt content if marked as encrypted
  if (row && row.IS_ENCRYPTED) {
    try {
      row.CONTENT = getEncryptor().decrypt(row.CONTENT);
      row.IS_ENCRYPTED = 0;
    } catch (err) {
      logger.error(`[DonkeyDao] Failed to decrypt content (messageId=${messageId}, metaDataId=${metaDataId}, contentType=${contentType}): ${err}`);
    }
  }

  return row;
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
 * Get connector messages filtered by status.
 * Optionally filter by messageId as well.
 * Used for recovery tasks to find messages in specific states.
 */
export async function getConnectorMessagesByStatus(
  channelId: string,
  statuses: Status[],
  messageId?: number,
  conn?: DbConnection
): Promise<ConnectorMessageRow[]> {
  const db = conn ?? getPool();
  const statusChars = statuses.map(s => s as string);
  const placeholders = statusChars.map(() => '?').join(', ');
  let sql = `SELECT * FROM ${connectorMessageTable(channelId)} WHERE STATUS IN (${placeholders})`;
  const params: (string | number)[] = [...statusChars];
  if (messageId !== undefined) {
    sql += ` AND MESSAGE_ID = ?`;
    params.push(messageId);
  }
  sql += ` ORDER BY MESSAGE_ID, METADATA_ID`;
  const [rows] = await db.query<ConnectorMessageRow[]>(sql, params);
  return rows;
}

/**
 * Get connector messages in RECEIVED or PENDING status (for recovery on startup).
 */
export async function getPendingConnectorMessages(
  channelId: string,
  conn?: DbConnection
): Promise<ConnectorMessageRow[]> {
  return getConnectorMessagesByStatus(channelId, [Status.RECEIVED, Status.PENDING], undefined, conn);
}

/**
 * Update statistics for a connector
 */
export async function updateStatistics(
  channelId: string,
  metaDataId: number,
  serverId: string,
  status: Status,
  increment: number = 1,
  conn?: DbConnection
): Promise<void> {
  const statusColumn = statusToColumn(status);
  const db = conn ?? getPool();

  await db.execute(
    `INSERT INTO ${statisticsTable(channelId)} (METADATA_ID, SERVER_ID, ${statusColumn})
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE ${statusColumn} = ${statusColumn} + ?`,
    [metaDataId, serverId, increment, increment]
  );
}

/**
 * Batch-persist accumulated statistics.
 * Sorts channel-level (metaDataId=0) first per MIRTH-3042 to avoid deadlocks.
 *
 * Ported from: Java Mirth Statistics.update() batching pattern.
 */
export async function addChannelStatistics(
  channelId: string,
  serverId: string,
  stats: Map<number, Map<Status, number>>,
  conn?: DbConnection
): Promise<void> {
  // Sort: channel-level (metaDataId=0) first per MIRTH-3042
  const sortedEntries = [...stats.entries()].sort(([a], [b]) => a - b);
  for (const [metaDataId, statusMap] of sortedEntries) {
    for (const [status, count] of statusMap) {
      await updateStatistics(channelId, metaDataId, serverId, status, count, conn);
    }
  }
}

/**
 * Get statistics for a channel
 */
export async function getStatistics(channelId: string): Promise<StatisticsRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<StatisticsRow[]>(`SELECT * FROM ${statisticsTable(channelId)}`);
  return rows;
}

// ============================================================================
// Batch Content/Attachment Loading (for archive-before-prune)
// ============================================================================

/**
 * Get all content rows for a batch of message IDs.
 * Used by the DataPruner archive phase to avoid N+1 queries.
 */
export async function getContentBatch(
  channelId: string,
  messageIds: number[]
): Promise<ContentRow[]> {
  if (messageIds.length === 0) return [];
  const pool = getPool();
  const placeholders = messageIds.map(() => '?').join(', ');
  const [rows] = await pool.query<ContentRow[]>(
    `SELECT * FROM ${contentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
    messageIds
  );
  return rows;
}

/**
 * Get all attachment rows for a batch of message IDs.
 * Used by the DataPruner archive phase to avoid N+1 queries.
 */
export async function getAttachmentsBatch(
  channelId: string,
  messageIds: number[]
): Promise<AttachmentRow[]> {
  if (messageIds.length === 0) return [];
  const pool = getPool();
  const placeholders = messageIds.map(() => '?').join(', ');
  const [rows] = await pool.query<AttachmentRow[]>(
    `SELECT ID, MESSAGE_ID, TYPE, SEGMENT_ID, ATTACHMENT
     FROM ${attachmentTable(channelId)}
     WHERE MESSAGE_ID IN (${placeholders})
     ORDER BY ID, SEGMENT_ID`,
    messageIds
  );
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
  skipStatuses?: string[],
  skipIncomplete: boolean = true
): Promise<PruneMessageRow[]> {
  const pool = getPool();

  // Build the query with optional status filtering
  let query = `
    SELECT m.ID as messageId, m.RECEIVED_DATE as receivedDate
    FROM ${messageTable(channelId)} m
    WHERE m.RECEIVED_DATE < ?
  `;

  const params: (Date | string | number)[] = [dateThreshold];

  // Skip unprocessed (in-flight) messages to avoid pruning mid-pipeline
  if (skipIncomplete) {
    query += ` AND m.PROCESSED = 1`;
  }

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

    // Delete in order: content, attachments, custom metadata, connector messages, messages
    await connection.execute(
      `DELETE FROM ${contentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
      messageIds
    );

    await connection.execute(
      `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
      messageIds
    );

    await connection.execute(
      `DELETE FROM ${customMetadataTable(channelId)} WHERE MESSAGE_ID IN (${placeholders})`,
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

// ============================================================================
// Attachment Methods
// ============================================================================

/**
 * Row interface for attachment ID data
 */
interface AttachmentIdRow extends RowDataPacket {
  ID: string;
}

/**
 * Row interface for attachment data
 */
export interface AttachmentRow extends RowDataPacket {
  ID: string;
  MESSAGE_ID: number;
  TYPE: string | null;
  SEGMENT_ID: number;
  ATTACHMENT: Buffer | null;
}

/**
 * Get all attachment IDs for a message
 */
export async function getAttachmentIds(
  channelId: string,
  messageId: number
): Promise<string[]> {
  const pool = getPool();
  const [rows] = await pool.query<AttachmentIdRow[]>(
    `SELECT DISTINCT ID FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ? ORDER BY ID`,
    [messageId]
  );
  return rows.map((row) => row.ID);
}

/**
 * Get all attachments for a message
 */
export async function getAttachments(
  channelId: string,
  messageId: number
): Promise<AttachmentRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<AttachmentRow[]>(
    `SELECT ID, MESSAGE_ID, TYPE, SEGMENT_ID, ATTACHMENT
     FROM ${attachmentTable(channelId)}
     WHERE MESSAGE_ID = ?
     ORDER BY ID, SEGMENT_ID`,
    [messageId]
  );
  return rows;
}

/**
 * Get a specific attachment by ID
 */
export async function getAttachment(
  channelId: string,
  messageId: number,
  attachmentId: string
): Promise<AttachmentRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<AttachmentRow[]>(
    `SELECT ID, MESSAGE_ID, TYPE, SEGMENT_ID, ATTACHMENT
     FROM ${attachmentTable(channelId)}
     WHERE MESSAGE_ID = ? AND ID = ?
     ORDER BY SEGMENT_ID`,
    [messageId, attachmentId]
  );
  return rows;
}

/**
 * Insert a new attachment
 * Large attachments may be split into multiple segments
 */
export async function insertAttachment(
  channelId: string,
  messageId: number,
  attachmentId: string,
  type: string | null,
  content: Buffer
): Promise<void> {
  const pool = getPool();

  // For simplicity, store as single segment
  // In production, large attachments would be split into 10MB segments
  await pool.execute(
    `INSERT INTO ${attachmentTable(channelId)} (ID, MESSAGE_ID, TYPE, SEGMENT_ID, ATTACHMENT)
     VALUES (?, ?, ?, 0, ?)`,
    [attachmentId, messageId, type, content]
  );
}

/**
 * Update an existing attachment
 */
export async function updateAttachment(
  channelId: string,
  messageId: number,
  attachmentId: string,
  type: string | null,
  content: Buffer
): Promise<void> {
  const pool = getPool();

  // Delete existing segments and insert new one
  await pool.execute(
    `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ? AND ID = ?`,
    [messageId, attachmentId]
  );

  await insertAttachment(channelId, messageId, attachmentId, type, content);
}

/**
 * Delete a specific attachment
 */
export async function deleteAttachment(
  channelId: string,
  messageId: number,
  attachmentId: string
): Promise<number> {
  const pool = getPool();

  const [result] = await pool.execute(
    `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ? AND ID = ?`,
    [messageId, attachmentId]
  );

  return (result as { affectedRows: number }).affectedRows;
}

// ============================================================================
// Statistics Reset / Message Reset Methods
// ============================================================================

/**
 * Reset statistics counters to zero.
 * Ported from JdbcDao.resetStatistics().
 *
 * Optionally scoped to a specific connector (metaDataId) and/or server.
 */
export async function resetStatistics(
  channelId: string,
  metaDataId?: number,
  serverId?: string
): Promise<void> {
  const pool = getPool();
  let query = `UPDATE ${statisticsTable(channelId)} SET RECEIVED=0, FILTERED=0, TRANSFORMED=0, PENDING=0, SENT=0, ERROR=0`;
  const params: (string | number)[] = [];
  if (metaDataId !== undefined) {
    query += ` WHERE METADATA_ID = ?`;
    params.push(metaDataId);
    if (serverId) {
      query += ` AND SERVER_ID = ?`;
      params.push(serverId);
    }
  }
  await pool.execute(query, params);
}

/**
 * Reset a message for reprocessing.
 * Ported from JdbcDao.resetMessage().
 *
 * Sets PROCESSED=0 on the message, and resets all destination connector messages
 * (METADATA_ID > 0) to PENDING status with zero send attempts.
 */
export async function resetMessage(
  channelId: string,
  messageId: number
): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `UPDATE ${messageTable(channelId)} SET PROCESSED = 0 WHERE ID = ?`,
    [messageId]
  );
  await pool.execute(
    `UPDATE ${connectorMessageTable(channelId)} SET STATUS = 'P', SEND_ATTEMPTS = 0, SEND_DATE = NULL, RESPONSE_DATE = NULL, ERROR_CODE = NULL WHERE MESSAGE_ID = ? AND METADATA_ID > 0`,
    [messageId]
  );
}

// ============================================================================
// Targeted Delete Methods
// ============================================================================

/**
 * Delete connector messages for specific metadata IDs.
 * Ported from JdbcDao.deleteConnectorMessages() with metaDataId filtering.
 */
export async function deleteConnectorMessagesByMetaDataIds(
  channelId: string,
  messageId: number,
  metaDataIds: number[]
): Promise<number> {
  if (metaDataIds.length === 0) return 0;
  const pool = getPool();
  const placeholders = metaDataIds.map(() => '?').join(', ');
  const [result] = await pool.execute(
    `DELETE FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID = ? AND METADATA_ID IN (${placeholders})`,
    [messageId, ...metaDataIds]
  );
  return (result as { affectedRows: number }).affectedRows;
}

/**
 * Delete message content for specific metadata IDs.
 * Ported from JdbcDao.deleteMessageContent() with metaDataId filtering.
 */
export async function deleteMessageContentByMetaDataIds(
  channelId: string,
  messageId: number,
  metaDataIds: number[]
): Promise<number> {
  if (metaDataIds.length === 0) return 0;
  const pool = getPool();
  const placeholders = metaDataIds.map(() => '?').join(', ');
  const [result] = await pool.execute(
    `DELETE FROM ${contentTable(channelId)} WHERE MESSAGE_ID = ? AND METADATA_ID IN (${placeholders})`,
    [messageId, ...metaDataIds]
  );
  return (result as { affectedRows: number }).affectedRows;
}

/**
 * Delete statistics row for a specific connector.
 * Ported from JdbcDao.deleteStatistics().
 */
export async function deleteMessageStatistics(
  channelId: string,
  metaDataId: number
): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `DELETE FROM ${statisticsTable(channelId)} WHERE METADATA_ID = ?`,
    [metaDataId]
  );
}

/**
 * Delete all content for a single message.
 * Ported from JdbcDao.deleteMessageContent() (single message variant).
 */
export async function deleteMessageContent(
  channelId: string,
  messageId: number
): Promise<number> {
  const pool = getPool();
  const [result] = await pool.execute(
    `DELETE FROM ${contentTable(channelId)} WHERE MESSAGE_ID = ?`,
    [messageId]
  );
  return (result as { affectedRows: number }).affectedRows;
}

/**
 * Delete all attachments for a single message.
 * Ported from JdbcDao.deleteMessageAttachments() (single message variant).
 */
export async function deleteMessageAttachments(
  channelId: string,
  messageId: number
): Promise<number> {
  const pool = getPool();
  const [result] = await pool.execute(
    `DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ?`,
    [messageId]
  );
  return (result as { affectedRows: number }).affectedRows;
}

/**
 * Delete a single message and all related rows.
 * Ported from JdbcDao.deleteMessage() (single message variant).
 */
export async function deleteMessage(channelId: string, messageId: number): Promise<void> {
  await transaction(async (conn) => {
    await conn.execute(`DELETE FROM ${contentTable(channelId)} WHERE MESSAGE_ID = ?`, [messageId]);
    await conn.execute(`DELETE FROM ${attachmentTable(channelId)} WHERE MESSAGE_ID = ?`, [messageId]);
    await conn.execute(`DELETE FROM ${customMetadataTable(channelId)} WHERE MESSAGE_ID = ?`, [messageId]);
    await conn.execute(`DELETE FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID = ?`, [messageId]);
    await conn.execute(`DELETE FROM ${messageTable(channelId)} WHERE ID = ?`, [messageId]);
  });
}

/**
 * Get multiple messages by ID.
 * Ported from JdbcDao.getMessages() (bulk variant).
 */
export async function getMessages(channelId: string, messageIds: number[]): Promise<MessageRow[]> {
  if (messageIds.length === 0) return [];
  const pool = getPool();
  const placeholders = messageIds.map(() => '?').join(', ');
  const [rows] = await pool.query<MessageRow[]>(
    `SELECT * FROM ${messageTable(channelId)} WHERE ID IN (${placeholders}) ORDER BY ID`,
    messageIds
  );
  return rows;
}

// ============================================================================
// Query Methods
// ============================================================================

/**
 * Get unfinished (unprocessed) messages for a channel.
 * Ported from JdbcDao.getUnfinishedMessages().
 *
 * Used during channel startup to resume processing of incomplete messages.
 *
 * @deprecated Use {@link getUnfinishedMessagesByServerId} in cluster deployments
 *   so each instance only recovers its own messages.
 */
export async function getUnfinishedMessages(channelId: string): Promise<MessageRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<MessageRow[]>(
    `SELECT * FROM ${messageTable(channelId)} WHERE PROCESSED = 0 ORDER BY ID`
  );
  return rows;
}

/**
 * Get unfinished messages filtered by SERVER_ID.
 * In a cluster, each instance should only recover its own messages.
 */
export async function getUnfinishedMessagesByServerId(
  channelId: string,
  serverId: string
): Promise<MessageRow[]> {
  const pool = getPool();
  const [rows] = await pool.query<MessageRow[]>(
    `SELECT * FROM ${messageTable(channelId)} WHERE PROCESSED = 0 AND SERVER_ID = ? ORDER BY ID`,
    [serverId]
  );
  return rows;
}

/**
 * Get the maximum message ID for a channel.
 * Ported from JdbcDao.getMaxMessageId().
 */
export async function getMaxMessageId(channelId: string): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(ID) as maxId FROM ${messageTable(channelId)}`
  );
  return rows[0]?.maxId ?? null;
}

/**
 * Get the minimum message ID for a channel.
 * Ported from JdbcDao.getMinMessageId().
 */
export async function getMinMessageId(channelId: string): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT MIN(ID) as minId FROM ${messageTable(channelId)}`
  );
  return rows[0]?.minId ?? null;
}

// ============================================================================
// Custom Metadata Methods
// ============================================================================

/**
 * Insert or update custom metadata for a connector message.
 * Ported from JdbcDao.insertMetaData().
 *
 * Uses INSERT ... ON DUPLICATE KEY UPDATE to upsert user-defined metadata
 * columns in the D_MCM table.
 */
export async function insertCustomMetaData(
  channelId: string,
  messageId: number,
  metaDataId: number,
  data: Record<string, unknown>,
  conn?: DbConnection
): Promise<void> {
  const db = conn ?? getPool();
  const columns = Object.keys(data);
  if (columns.length === 0) return;

  const colNames = columns.map(c => `\`${c}\``).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(c => data[c]);

  await db.execute(
    `INSERT INTO ${customMetadataTable(channelId)} (MESSAGE_ID, METADATA_ID, ${colNames}) VALUES (?, ?, ${placeholders})
     ON DUPLICATE KEY UPDATE ${columns.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')}`,
    [messageId, metaDataId, ...values]
  );
}

/**
 * Add a custom metadata column to the D_MCM table.
 * Ported from JdbcDao.addMetaDataColumn().
 *
 * Silently ignores ER_DUP_FIELDNAME if the column already exists.
 */
export async function addMetaDataColumn(
  channelId: string,
  columnName: string,
  columnType: string = 'TEXT'
): Promise<void> {
  const pool = getPool();
  try {
    await pool.execute(
      `ALTER TABLE ${customMetadataTable(channelId)} ADD COLUMN \`${columnName}\` ${columnType}`
    );
  } catch (err: unknown) {
    // Column may already exist — ignore duplicate column errors
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ER_DUP_FIELDNAME') {
      return;
    }
    throw err;
  }
}

// ============================================================================
// Bulk Delete / Connector Query / Schema Modification Methods
// ============================================================================

/**
 * Delete all messages and related data for a channel.
 * Ported from JdbcDao.deleteAllMessages().
 *
 * Deletes from child tables first (foreign-key safe order):
 * D_MC, D_MA, D_MCM, D_MM, D_M
 */
export async function deleteAllMessages(channelId: string): Promise<void> {
  await transaction(async (connection) => {
    await connection.execute(`DELETE FROM ${contentTable(channelId)}`);
    await connection.execute(`DELETE FROM ${attachmentTable(channelId)}`);
    await connection.execute(`DELETE FROM ${customMetadataTable(channelId)}`);
    await connection.execute(`DELETE FROM ${connectorMessageTable(channelId)}`);
    await connection.execute(`DELETE FROM ${messageTable(channelId)}`);
  });
}

/**
 * Get count of connector messages matching a specific status.
 * Ported from JdbcDao.getConnectorMessageCount().
 *
 * Joins D_MM with D_M to filter by server ID.
 */
interface CountRow extends RowDataPacket {
  cnt: number;
}

export async function getConnectorMessageCount(
  channelId: string,
  serverId: string,
  metaDataId: number,
  status: Status
): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) as cnt FROM ${connectorMessageTable(channelId)} mm INNER JOIN ${messageTable(channelId)} m ON mm.MESSAGE_ID = m.ID WHERE m.SERVER_ID = ? AND mm.METADATA_ID = ? AND mm.STATUS = ?`,
    [serverId, metaDataId, status]
  );
  return rows[0]!.cnt;
}

/**
 * Get status of all connector messages for a specific message.
 * Ported from JdbcDao.getConnectorMessageStatuses().
 *
 * Returns a Map of metaDataId -> Status.
 */
interface StatusRow extends RowDataPacket {
  METADATA_ID: number;
  STATUS: string;
}

export async function getConnectorMessageStatuses(
  channelId: string,
  messageId: number
): Promise<Map<number, Status>> {
  const pool = getPool();
  const [rows] = await pool.query<StatusRow[]>(
    `SELECT METADATA_ID, STATUS FROM ${connectorMessageTable(channelId)} WHERE MESSAGE_ID = ?`,
    [messageId]
  );
  const result = new Map<number, Status>();
  for (const row of rows) {
    result.set(row.METADATA_ID, parseStatus(row.STATUS));
  }
  return result;
}

/**
 * Get the maximum connector message ID (MESSAGE_ID) from D_MM.
 * Ported from JdbcDao.getMaxConnectorMessageId().
 */
export async function getMaxConnectorMessageId(channelId: string): Promise<number | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(MESSAGE_ID) as maxId FROM ${connectorMessageTable(channelId)}`
  );
  return rows[0]?.maxId ?? null;
}

/**
 * Remove a custom metadata column from the D_MCM table.
 * Ported from JdbcDao.removeMetaDataColumn().
 *
 * Silently ignores ER_CANT_DROP_FIELD_OR_KEY if the column doesn't exist.
 */
export async function removeMetaDataColumn(
  channelId: string,
  columnName: string
): Promise<void> {
  const pool = getPool();
  try {
    await pool.execute(
      `ALTER TABLE ${customMetadataTable(channelId)} DROP COLUMN \`${columnName}\``
    );
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ER_CANT_DROP_FIELD_OR_KEY') {
      return;
    }
    throw err;
  }
}
