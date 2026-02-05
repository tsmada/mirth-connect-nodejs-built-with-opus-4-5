/**
 * SchemaManager - Database schema management for dual operational modes
 *
 * This is a stub file that will be implemented by the schema-manager agent.
 * It provides the interface expected by Mirth.ts and EngineController.ts.
 */

import { getPool } from './pool.js';
import type { RowDataPacket } from 'mysql2/promise';

export type OperationalMode = 'takeover' | 'standalone';

/**
 * Detect the operational mode based on environment and database state.
 *
 * Mode detection priority:
 * 1. MIRTH_MODE environment variable (if set to 'takeover' or 'standalone')
 * 2. Auto-detect: 'takeover' if existing Mirth schema found, 'standalone' otherwise
 */
export async function detectMode(): Promise<OperationalMode> {
  const envMode = process.env['MIRTH_MODE'];

  if (envMode === 'takeover' || envMode === 'standalone') {
    return envMode;
  }

  // Auto-detect based on schema presence
  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SCHEMA_INFO'
    `);
    return rows.length > 0 ? 'takeover' : 'standalone';
  } catch {
    return 'standalone';
  }
}

export interface SchemaVerificationResult {
  compatible: boolean;
  version: string | null;
  errors: string[];
}

/**
 * Verify that the existing schema is compatible with this runtime.
 */
export async function verifySchema(): Promise<SchemaVerificationResult> {
  const pool = getPool();
  const errors: string[] = [];

  // Required tables for Mirth operation
  const requiredTables = [
    'CHANNEL', 'CONFIGURATION', 'PERSON', 'EVENT', 'ALERT',
    'CODE_TEMPLATE', 'CODE_TEMPLATE_LIBRARY', 'CHANNEL_GROUP',
    'SCRIPT', 'D_CHANNELS',
  ];

  try {
    // Check for required tables
    for (const table of requiredTables) {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      `, [table]);

      if (rows.length === 0) {
        errors.push(`Missing required table: ${table}`);
      }
    }

    // Get schema version
    let version: string | null = null;
    try {
      const [versionRows] = await pool.query<RowDataPacket[]>(
        `SELECT VERSION FROM SCHEMA_INFO LIMIT 1`
      );
      if (versionRows.length > 0) {
        version = versionRows[0]!.VERSION;
      }
    } catch {
      // SCHEMA_INFO may not exist
    }

    return {
      compatible: errors.length === 0,
      version: version ?? '3.9.1',
      errors,
    };
  } catch (error) {
    return {
      compatible: false,
      version: null,
      errors: [`Schema verification failed: ${error}`],
    };
  }
}

/**
 * Ensure core tables exist for standalone mode.
 */
export async function ensureCoreTables(): Promise<void> {
  const pool = getPool();

  // Create SCHEMA_INFO table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS SCHEMA_INFO (
      VERSION VARCHAR(40)
    )
  `);

  // Create CONFIGURATION table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS CONFIGURATION (
      CATEGORY VARCHAR(255) NOT NULL,
      NAME VARCHAR(255) NOT NULL,
      VALUE LONGTEXT,
      PRIMARY KEY (CATEGORY, NAME)
    )
  `);

  // Create PERSON table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS PERSON (
      ID INT NOT NULL AUTO_INCREMENT,
      USERNAME VARCHAR(40) NOT NULL,
      FIRST_NAME VARCHAR(40),
      LAST_NAME VARCHAR(40),
      ORGANIZATION VARCHAR(255),
      EMAIL VARCHAR(255),
      PHONE_NUMBER VARCHAR(40),
      DESCRIPTION VARCHAR(255),
      INDUSTRY VARCHAR(255),
      LAST_LOGIN DATETIME,
      GRACE_PERIOD_START DATETIME,
      STRUCK_OUT BOOLEAN DEFAULT FALSE,
      LOGGED_IN BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (ID),
      UNIQUE KEY (USERNAME)
    )
  `);

  // Create PERSON_PASSWORD table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS PERSON_PASSWORD (
      PERSON_ID INT NOT NULL,
      PASSWORD VARCHAR(255) NOT NULL,
      PASSWORD_DATE DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (PERSON_ID)
    )
  `);

  // Create CHANNEL table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS CHANNEL (
      ID VARCHAR(255) NOT NULL,
      NAME VARCHAR(255) NOT NULL,
      REVISION INT DEFAULT 0,
      CHANNEL LONGTEXT,
      PRIMARY KEY (ID)
    )
  `);

  // Create D_CHANNELS table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_CHANNELS (
      LOCAL_CHANNEL_ID INT NOT NULL AUTO_INCREMENT,
      CHANNEL_ID VARCHAR(255) NOT NULL,
      PRIMARY KEY (LOCAL_CHANNEL_ID),
      UNIQUE KEY (CHANNEL_ID)
    )
  `);

  // Create EVENT table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS EVENT (
      ID INT NOT NULL AUTO_INCREMENT,
      DATE_CREATED DATETIME DEFAULT CURRENT_TIMESTAMP,
      EVENT_LEVEL VARCHAR(40),
      NAME VARCHAR(255),
      ATTRIBUTES LONGTEXT,
      OUTCOME VARCHAR(40),
      USER_ID INT,
      IP_ADDRESS VARCHAR(40),
      SERVER_ID VARCHAR(255),
      PRIMARY KEY (ID)
    )
  `);

  // Create ALERT table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ALERT (
      ID VARCHAR(255) NOT NULL,
      NAME VARCHAR(255) NOT NULL,
      ALERT LONGTEXT,
      PRIMARY KEY (ID)
    )
  `);

  // Create CODE_TEMPLATE_LIBRARY table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS CODE_TEMPLATE_LIBRARY (
      ID VARCHAR(255) NOT NULL,
      NAME VARCHAR(255) NOT NULL,
      REVISION INT DEFAULT 0,
      LIBRARY LONGTEXT,
      PRIMARY KEY (ID)
    )
  `);

  // Create CODE_TEMPLATE table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS CODE_TEMPLATE (
      ID VARCHAR(255) NOT NULL,
      NAME VARCHAR(255) NOT NULL,
      REVISION INT DEFAULT 0,
      CODE_TEMPLATE LONGTEXT,
      PRIMARY KEY (ID)
    )
  `);

  // Create CHANNEL_GROUP table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS CHANNEL_GROUP (
      ID VARCHAR(255) NOT NULL,
      NAME VARCHAR(255) NOT NULL,
      REVISION INT DEFAULT 0,
      CHANNEL_GROUP LONGTEXT,
      PRIMARY KEY (ID)
    )
  `);

  // Create SCRIPT table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS SCRIPT (
      GROUP_ID VARCHAR(255) NOT NULL,
      ID VARCHAR(255) NOT NULL,
      SCRIPT LONGTEXT,
      PRIMARY KEY (GROUP_ID, ID)
    )
  `);

  // Insert schema version if not exists
  const [existing] = await pool.query<RowDataPacket[]>('SELECT * FROM SCHEMA_INFO');
  if (existing.length === 0) {
    await pool.execute(`INSERT INTO SCHEMA_INFO (VERSION) VALUES ('3.9.1')`);
  }
}

/**
 * Seed default data for standalone mode.
 */
export async function seedDefaults(): Promise<void> {
  const pool = getPool();

  // Check if admin user exists
  const [existingUser] = await pool.query<RowDataPacket[]>(
    `SELECT ID FROM PERSON WHERE USERNAME = 'admin'`
  );

  if (existingUser.length === 0) {
    // Create default admin user
    const [result] = await pool.execute(
      `INSERT INTO PERSON (USERNAME, FIRST_NAME, LAST_NAME) VALUES ('admin', 'Admin', 'User')`
    );
    const adminId = (result as { insertId: number }).insertId;

    // Set default password (this should be changed on first login)
    // Default: 'admin' with bcrypt hash
    const defaultPasswordHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    await pool.execute(
      `INSERT INTO PERSON_PASSWORD (PERSON_ID, PASSWORD) VALUES (?, ?)`,
      [adminId, defaultPasswordHash]
    );
  }

  // Seed default configuration if not exists
  const [existingConfig] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM CONFIGURATION WHERE CATEGORY = 'core' AND NAME = 'stats.enabled'`
  );

  if (existingConfig.length === 0) {
    await pool.execute(
      `INSERT INTO CONFIGURATION (CATEGORY, NAME, VALUE) VALUES ('core', 'stats.enabled', '1')`
    );
  }
}

/**
 * Ensure channel-specific tables exist (D_M{id}, D_MM{id}, etc.)
 */
export async function ensureChannelTables(channelId: string): Promise<void> {
  const pool = getPool();

  // Get or create local channel ID
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID = ?`,
    [channelId]
  );

  if (existing.length === 0) {
    await pool.execute(
      `INSERT INTO D_CHANNELS (CHANNEL_ID) VALUES (?)`,
      [channelId]
    );
  }

  // Create per-channel tables
  const tableId = channelId.replace(/-/g, '_');

  // D_M{id} - Messages
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_M${tableId} (
      ID BIGINT NOT NULL AUTO_INCREMENT,
      SERVER_ID VARCHAR(255),
      RECEIVED_DATE DATETIME DEFAULT CURRENT_TIMESTAMP,
      PROCESSED BOOLEAN DEFAULT FALSE,
      ORIGINAL_ID BIGINT,
      IMPORT_ID BIGINT,
      IMPORT_CHANNEL_ID VARCHAR(255),
      PRIMARY KEY (ID)
    )
  `);

  // D_MM{id} - Message Metadata
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_MM${tableId} (
      ID INT NOT NULL,
      MESSAGE_ID BIGINT NOT NULL,
      RECEIVED_DATE DATETIME DEFAULT CURRENT_TIMESTAMP,
      STATUS CHAR(1) DEFAULT 'R',
      CONNECTOR_MAP LONGTEXT,
      CHANNEL_MAP LONGTEXT,
      RESPONSE_MAP LONGTEXT,
      ERRORS LONGTEXT,
      SEND_ATTEMPTS INT DEFAULT 0,
      SEND_DATE DATETIME,
      RESPONSE_DATE DATETIME,
      ERROR_CODE INT DEFAULT 0,
      CHAIN_ID INT DEFAULT 0,
      ORDER_ID INT DEFAULT 0,
      PRIMARY KEY (ID, MESSAGE_ID)
    )
  `);

  // D_MC{id} - Message Content
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_MC${tableId} (
      METADATA_ID INT NOT NULL,
      MESSAGE_ID BIGINT NOT NULL,
      CONTENT_TYPE INT NOT NULL,
      CONTENT LONGTEXT,
      IS_ENCRYPTED BOOLEAN DEFAULT FALSE,
      DATA_TYPE VARCHAR(255),
      PRIMARY KEY (METADATA_ID, MESSAGE_ID, CONTENT_TYPE)
    )
  `);

  // D_MA{id} - Message Attachments
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_MA${tableId} (
      ID VARCHAR(255) NOT NULL,
      MESSAGE_ID BIGINT NOT NULL,
      TYPE VARCHAR(255),
      CONTENT LONGBLOB,
      PRIMARY KEY (ID, MESSAGE_ID)
    )
  `);

  // D_MS{id} - Message Statistics
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_MS${tableId} (
      METADATA_ID INT NOT NULL,
      RECEIVED BIGINT DEFAULT 0,
      FILTERED BIGINT DEFAULT 0,
      TRANSFORMED BIGINT DEFAULT 0,
      PENDING BIGINT DEFAULT 0,
      SENT BIGINT DEFAULT 0,
      ERRORED BIGINT DEFAULT 0,
      PRIMARY KEY (METADATA_ID)
    )
  `);

  // D_MSQ{id} - Message Sequences
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_MSQ${tableId} (
      ID INT NOT NULL AUTO_INCREMENT,
      PRIMARY KEY (ID)
    )
  `);

  // D_MCM{id} - Custom Metadata
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS D_MCM${tableId} (
      METADATA_ID INT NOT NULL,
      MESSAGE_ID BIGINT NOT NULL,
      METADATA_MAP LONGTEXT,
      PRIMARY KEY (METADATA_ID, MESSAGE_ID)
    )
  `);
}

/**
 * Check if channel tables exist.
 */
export async function channelTablesExist(channelId: string): Promise<boolean> {
  const pool = getPool();
  const tableId = channelId.replace(/-/g, '_');

  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [`D_M${tableId}`]);

  return rows.length > 0;
}
