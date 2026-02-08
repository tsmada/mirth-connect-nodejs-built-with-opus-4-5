/**
 * Schema Manager for Mirth Connect Node.js Runtime
 *
 * Handles dual operational modes:
 * - 'takeover': Use existing Java Mirth database schema
 * - 'standalone': Create fresh schema for Node.js-only deployment
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/migration
 * Reference: ~/Projects/connect/server/dbconf/mysql/mysql-database.sql
 */

import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPool, transaction } from './pool.js';
import { createChannelTables, channelTablesExist as donkeyChannelTablesExist } from './DonkeyDao.js';

export type OperationalMode = 'takeover' | 'standalone';

export interface SchemaVerificationResult {
  compatible: boolean;
  version: string | null;
  errors: string[];
}

// Required core tables for Mirth Connect
const REQUIRED_TABLES = [
  'CHANNEL',
  'CONFIGURATION',
  'PERSON',
  'PERSON_PASSWORD',
  'EVENT',
  'ALERT',
  'CODE_TEMPLATE',
  'CODE_TEMPLATE_LIBRARY',
  'CHANNEL_GROUP',
  'SCRIPT',
];

// Row interfaces for typed queries
interface TableExistsRow extends RowDataPacket {
  TABLE_NAME: string;
}

interface SchemaVersionRow extends RowDataPacket {
  VERSION: string;
}


/**
 * Detect operational mode based on environment or database state
 *
 * Priority:
 * 1. MIRTH_MODE env var ('takeover' or 'standalone')
 * 2. Auto-detect by checking if CHANNEL table exists
 */
export async function detectMode(): Promise<OperationalMode> {
  const envMode = process.env.MIRTH_MODE?.toLowerCase();

  if (envMode === 'takeover') {
    return 'takeover';
  }

  if (envMode === 'standalone') {
    return 'standalone';
  }

  // Auto-detect: check if CHANNEL table exists
  try {
    const pool = getPool();
    const [rows] = await pool.query<TableExistsRow[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CHANNEL'`
    );

    if (rows.length > 0) {
      console.warn('[SchemaManager] Auto-detected mode: takeover (existing schema found)');
      return 'takeover';
    }
  } catch {
    // If we can't query, assume standalone
  }

  console.warn('[SchemaManager] Auto-detected mode: standalone (no existing schema)');
  return 'standalone';
}

/**
 * Verify that the database schema is compatible
 *
 * Checks:
 * - SCHEMA_INFO table exists
 * - Version is readable
 * - All required tables exist
 */
export async function verifySchema(): Promise<SchemaVerificationResult> {
  const errors: string[] = [];
  let version: string | null = null;

  try {
    const pool = getPool();

    // Check if SCHEMA_INFO table exists
    const [schemaInfoExists] = await pool.query<TableExistsRow[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SCHEMA_INFO'`
    );

    if (schemaInfoExists.length === 0) {
      errors.push('Missing table: SCHEMA_INFO');
    } else {
      // Query version
      const [versionRows] = await pool.query<SchemaVersionRow[]>(
        `SELECT VERSION FROM SCHEMA_INFO LIMIT 1`
      );
      version = versionRows[0]?.VERSION ?? null;

      if (!version) {
        errors.push('SCHEMA_INFO table is empty');
      }
    }

    // Check required tables
    const [existingTables] = await pool.query<TableExistsRow[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${REQUIRED_TABLES.map(() => '?').join(', ')})`,
      REQUIRED_TABLES
    );

    const existingTableNames = new Set(existingTables.map((row: TableExistsRow) => row.TABLE_NAME));

    for (const table of REQUIRED_TABLES) {
      if (!existingTableNames.has(table)) {
        errors.push(`Missing table: ${table}`);
      }
    }
  } catch (err) {
    errors.push(`Database error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    compatible: errors.length === 0,
    version,
    errors,
  };
}

/**
 * Create all core tables if they don't exist
 *
 * Uses CREATE TABLE IF NOT EXISTS for idempotency
 */
export async function ensureCoreTables(): Promise<void> {
  console.warn('[SchemaManager] Ensuring core tables exist...');

  await transaction(async (connection) => {
    // SCHEMA_INFO
    await connection.query(`
      CREATE TABLE IF NOT EXISTS SCHEMA_INFO (
        VERSION VARCHAR(40)
      ) ENGINE=InnoDB
    `);

    // CHANNEL
    await connection.query(`
      CREATE TABLE IF NOT EXISTS CHANNEL (
        ID CHAR(36) NOT NULL PRIMARY KEY,
        NAME VARCHAR(40) NOT NULL,
        REVISION INTEGER,
        CHANNEL LONGTEXT
      ) ENGINE=InnoDB
    `);

    // CONFIGURATION
    await connection.query(`
      CREATE TABLE IF NOT EXISTS CONFIGURATION (
        CATEGORY VARCHAR(255) NOT NULL,
        NAME VARCHAR(255) NOT NULL,
        VALUE LONGTEXT,
        PRIMARY KEY(CATEGORY, NAME)
      ) ENGINE=InnoDB
    `);

    // PERSON
    await connection.query(`
      CREATE TABLE IF NOT EXISTS PERSON (
        ID INTEGER NOT NULL AUTO_INCREMENT PRIMARY KEY,
        USERNAME VARCHAR(40) NOT NULL UNIQUE,
        FIRST_NAME VARCHAR(40),
        LAST_NAME VARCHAR(40),
        ORGANIZATION VARCHAR(255),
        EMAIL VARCHAR(255),
        PHONE_NUMBER VARCHAR(40),
        DESCRIPTION VARCHAR(255),
        INDUSTRY VARCHAR(255),
        LAST_LOGIN TIMESTAMP NULL DEFAULT NULL,
        GRACE_PERIOD_START TIMESTAMP NULL DEFAULT NULL,
        STRIKE_COUNT INTEGER NOT NULL DEFAULT 0,
        LOGGED_IN BIT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB
    `);

    // PERSON_PASSWORD
    await connection.query(`
      CREATE TABLE IF NOT EXISTS PERSON_PASSWORD (
        PERSON_ID INTEGER NOT NULL,
        PASSWORD VARCHAR(255) NOT NULL,
        PASSWORD_DATE TIMESTAMP NULL DEFAULT NULL,
        CONSTRAINT PERSON_ID_PP_FK FOREIGN KEY(PERSON_ID) REFERENCES PERSON(ID) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // PERSON_PREFERENCE
    await connection.query(`
      CREATE TABLE IF NOT EXISTS PERSON_PREFERENCE (
        PERSON_ID INTEGER NOT NULL,
        NAME VARCHAR(255) NOT NULL,
        VALUE LONGTEXT,
        PRIMARY KEY(PERSON_ID, NAME),
        CONSTRAINT PERSON_ID_PERSON_PREF_FK FOREIGN KEY(PERSON_ID) REFERENCES PERSON(ID) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // EVENT
    await connection.query(`
      CREATE TABLE IF NOT EXISTS EVENT (
        ID INTEGER NOT NULL AUTO_INCREMENT PRIMARY KEY,
        DATE_CREATED TIMESTAMP NULL DEFAULT NULL,
        NAME LONGTEXT NOT NULL,
        EVENT_LEVEL VARCHAR(40) NOT NULL,
        OUTCOME VARCHAR(40) NOT NULL,
        ATTRIBUTES LONGTEXT,
        USER_ID INTEGER NOT NULL,
        IP_ADDRESS VARCHAR(40),
        SERVER_ID CHARACTER VARYING(36)
      ) ENGINE=InnoDB
    `);

    // ALERT
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ALERT (
        ID VARCHAR(36) NOT NULL PRIMARY KEY,
        NAME VARCHAR(255) NOT NULL UNIQUE,
        ALERT LONGTEXT NOT NULL
      ) ENGINE=InnoDB
    `);

    // CODE_TEMPLATE_LIBRARY
    await connection.query(`
      CREATE TABLE IF NOT EXISTS CODE_TEMPLATE_LIBRARY (
        ID VARCHAR(255) NOT NULL PRIMARY KEY,
        NAME VARCHAR(255) NOT NULL UNIQUE,
        REVISION INTEGER,
        LIBRARY LONGTEXT
      ) ENGINE=InnoDB
    `);

    // CODE_TEMPLATE
    await connection.query(`
      CREATE TABLE IF NOT EXISTS CODE_TEMPLATE (
        ID VARCHAR(255) NOT NULL PRIMARY KEY,
        NAME VARCHAR(255) NOT NULL,
        REVISION INTEGER,
        CODE_TEMPLATE LONGTEXT
      ) ENGINE=InnoDB
    `);

    // CHANNEL_GROUP
    await connection.query(`
      CREATE TABLE IF NOT EXISTS CHANNEL_GROUP (
        ID VARCHAR(255) NOT NULL PRIMARY KEY,
        NAME VARCHAR(255) NOT NULL UNIQUE,
        REVISION INTEGER,
        CHANNEL_GROUP LONGTEXT
      ) ENGINE=InnoDB
    `);

    // SCRIPT
    await connection.query(`
      CREATE TABLE IF NOT EXISTS SCRIPT (
        GROUP_ID VARCHAR(40) NOT NULL,
        ID VARCHAR(40) NOT NULL,
        SCRIPT LONGTEXT,
        PRIMARY KEY(GROUP_ID, ID)
      ) ENGINE=InnoDB
    `);

    // D_CHANNELS - Channel ID to local channel ID mapping
    await connection.query(`
      CREATE TABLE IF NOT EXISTS D_CHANNELS (
        LOCAL_CHANNEL_ID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        CHANNEL_ID VARCHAR(36) NOT NULL UNIQUE
      ) ENGINE=InnoDB
    `);

    // D_SERVERS - Cluster node registry for multi-instance deployments
    await connection.query(`
      CREATE TABLE IF NOT EXISTS D_SERVERS (
        SERVER_ID VARCHAR(36) NOT NULL PRIMARY KEY,
        HOSTNAME VARCHAR(255),
        PORT INTEGER,
        API_URL VARCHAR(512),
        STARTED_AT TIMESTAMP NULL DEFAULT NULL,
        LAST_HEARTBEAT TIMESTAMP NULL DEFAULT NULL,
        STATUS VARCHAR(20) DEFAULT 'ONLINE'
      ) ENGINE=InnoDB
    `);

    // D_CHANNEL_DEPLOYMENTS - Tracks which channels are deployed on which instances
    await connection.query(`
      CREATE TABLE IF NOT EXISTS D_CHANNEL_DEPLOYMENTS (
        SERVER_ID VARCHAR(36) NOT NULL,
        CHANNEL_ID VARCHAR(36) NOT NULL,
        DEPLOYED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(SERVER_ID, CHANNEL_ID)
      ) ENGINE=InnoDB
    `);

    // D_CLUSTER_EVENTS - Polling-based event bus for cluster communication
    await connection.query(`
      CREATE TABLE IF NOT EXISTS D_CLUSTER_EVENTS (
        ID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        CHANNEL VARCHAR(255) NOT NULL,
        DATA LONGTEXT,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        SERVER_ID VARCHAR(36) NOT NULL
      ) ENGINE=InnoDB
    `);

    // D_GLOBAL_MAP - Shared global/channel map storage for clustered mode
    await connection.query(`
      CREATE TABLE IF NOT EXISTS D_GLOBAL_MAP (
        SCOPE VARCHAR(255) NOT NULL,
        MAP_KEY VARCHAR(255) NOT NULL,
        MAP_VALUE LONGTEXT,
        UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY(SCOPE, MAP_KEY)
      ) ENGINE=InnoDB
    `);
  });

  console.warn('[SchemaManager] Core tables ensured');
}

/**
 * Seed default data required for Mirth Connect operation
 *
 * - Admin user with default password
 * - Schema version
 * - Default configuration values
 * - Global script placeholders
 */
export async function seedDefaults(): Promise<void> {
  console.warn('[SchemaManager] Seeding default data...');

  await transaction(async (connection) => {
    // Use INSERT IGNORE to handle concurrent inserts safely (no TOCTOU race).
    // If another instance already inserted the admin user, this is a no-op.
    const [adminResult] = await connection.query<ResultSetHeader>(
      `INSERT IGNORE INTO PERSON (USERNAME, LOGGED_IN) VALUES ('admin', FALSE)`
    );

    if (adminResult.affectedRows > 0) {
      // Admin was actually created — insert the default password
      await connection.query(
        `INSERT INTO PERSON_PASSWORD (PERSON_ID, PASSWORD)
         SELECT ID, 'YzKZIAnbQ5m+3llggrZvNtf5fg69yX7pAplfYg0Dngn/fESH93OktQ=='
         FROM PERSON WHERE USERNAME = 'admin'`
      );

      console.warn('[SchemaManager] Created default admin user');
    }

    // Insert schema version (INSERT IGNORE for idempotency)
    await connection.query(
      `INSERT IGNORE INTO SCHEMA_INFO (VERSION) VALUES ('3.9.1')`
    );

    // Insert default configuration values (INSERT IGNORE for idempotency)
    const defaultConfigs = [
      ['core', 'stats.enabled', '1'],
      ['core', 'server.resetglobalvariables', '1'],
      ['core', 'smtp.timeout', '5000'],
      ['core', 'smtp.auth', '0'],
      ['core', 'smtp.secure', '0'],
      ['core', 'server.queuebuffersize', '1000'],
    ];

    for (const [category, name, value] of defaultConfigs) {
      await connection.query(
        `INSERT IGNORE INTO CONFIGURATION (CATEGORY, NAME, VALUE) VALUES (?, ?, ?)`,
        [category, name, value]
      );
    }

    // Insert global script placeholders
    const globalScripts = [
      ['Global', 'Deploy', ''],
      ['Global', 'Undeploy', ''],
      ['Global', 'Preprocessor', ''],
      ['Global', 'Postprocessor', ''],
    ];

    for (const [groupId, id, script] of globalScripts) {
      await connection.query(
        `INSERT IGNORE INTO SCRIPT (GROUP_ID, ID, SCRIPT) VALUES (?, ?, ?)`,
        [groupId, id, script]
      );
    }

    console.warn('[SchemaManager] Default configuration seeded');
  });
}

/**
 * Ensure channel-specific message tables exist
 *
 * 1. Registers channel in D_CHANNELS table
 * 2. Creates D_M{channelId}, D_MM{channelId}, etc. tables
 */
export async function ensureChannelTables(channelId: string): Promise<void> {
  console.warn(`[SchemaManager] Ensuring channel tables for ${channelId}...`);

  // Register in D_CHANNELS (INSERT IGNORE for idempotency)
  // Explicitly provide LOCAL_CHANNEL_ID to handle both AUTO_INCREMENT and
  // non-AUTO_INCREMENT schemas (takeover mode may have legacy table without AUTO_INCREMENT)
  const pool = getPool();
  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID = ?`,
    [channelId]
  );
  if (existing.length === 0) {
    const [maxRow] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(LOCAL_CHANNEL_ID), -1) + 1 AS next_id FROM D_CHANNELS`
    );
    const nextId = maxRow[0]?.next_id ?? 0;
    await pool.execute(
      `INSERT IGNORE INTO D_CHANNELS (LOCAL_CHANNEL_ID, CHANNEL_ID) VALUES (?, ?)`,
      [nextId, channelId]
    );
  }

  // Create the actual message tables using DonkeyDao
  await createChannelTables(channelId);

  console.warn(`[SchemaManager] Channel tables ensured for ${channelId}`);
}

/**
 * Check if channel tables exist
 *
 * Re-exports from DonkeyDao for convenience
 */
export async function channelTablesExist(channelId: string): Promise<boolean> {
  return donkeyChannelTablesExist(channelId);
}
