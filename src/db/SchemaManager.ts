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
import {
  createChannelTables,
  channelTablesExist as donkeyChannelTablesExist,
  validateChannelId,
} from './DonkeyDao.js';
import { getLogger, registerComponent } from '../logging/index.js';
import { MetaDataColumnType } from '../api/models/ServerSettings.js';

registerComponent('database', 'Database pool and queries');
const logger = getLogger('database');

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
      logger.info('Auto-detected mode: takeover (existing schema found)');
      return 'takeover';
    }
  } catch {
    // If we can't query, assume standalone
  }

  logger.info('Auto-detected mode: standalone (no existing schema)');
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
  logger.info('Ensuring core tables exist...');

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
        ROLE VARCHAR(50) DEFAULT 'admin',
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
  });

  // Also create Node.js-only tables (safe to call separately or as part of ensureCoreTables)
  await ensureNodeJsTables();

  logger.info('Core tables ensured');
}

/**
 * Create Node.js-only tables that Java Mirth ignores
 *
 * These tables are safe in a shared Java+Node.js database — Java Mirth ignores
 * unknown tables. Called from both standalone mode (via ensureCoreTables) and
 * takeover mode (directly after verifySchema).
 *
 * Uses CREATE TABLE IF NOT EXISTS for idempotency.
 */
export async function ensureNodeJsTables(): Promise<void> {
  await transaction(async (connection) => {
    // Migrate PERSON table: add ROLE column if not present (takeover mode compatibility)
    // Default to 'admin' so existing users retain full access
    try {
      await connection.query(
        `ALTER TABLE PERSON ADD COLUMN ROLE VARCHAR(50) DEFAULT 'admin'`
      );
      logger.info('Added ROLE column to PERSON table');
    } catch (err: unknown) {
      // Column already exists (MySQL error 1060: Duplicate column name)
      const mysqlErr = err as { code?: string };
      if (mysqlErr.code !== 'ER_DUP_FIELDNAME') {
        throw err;
      }
    }

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

    // Add VERSION column to D_GLOBAL_MAP for optimistic locking (CAS semantics)
    try {
      await connection.query(
        `ALTER TABLE D_GLOBAL_MAP ADD COLUMN VERSION BIGINT NOT NULL DEFAULT 0`
      );
      logger.info('Added VERSION column to D_GLOBAL_MAP table');
    } catch (err: unknown) {
      // Column already exists (MySQL error 1060: Duplicate column name)
      const mysqlErr = err as { code?: string };
      if (mysqlErr.code !== 'ER_DUP_FIELDNAME') {
        throw err;
      }
    }

    // D_ARTIFACT_SYNC - Git artifact sync tracking (Node.js-only)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS D_ARTIFACT_SYNC (
        ID VARCHAR(36) NOT NULL PRIMARY KEY,
        ARTIFACT_TYPE VARCHAR(20) NOT NULL,
        ARTIFACT_ID VARCHAR(36) NOT NULL,
        ARTIFACT_NAME VARCHAR(255),
        REVISION INT,
        COMMIT_HASH VARCHAR(40),
        SYNC_DIRECTION VARCHAR(10) NOT NULL,
        SYNCED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        SYNCED_BY VARCHAR(255),
        ENVIRONMENT VARCHAR(50),
        INDEX idx_artifact (ARTIFACT_TYPE, ARTIFACT_ID),
        INDEX idx_commit (COMMIT_HASH)
      ) ENGINE=InnoDB
    `);

    // D_POLLING_LEASES - Exclusive polling lease for clustered source connectors (Node.js-only)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS D_POLLING_LEASES (
        CHANNEL_ID VARCHAR(36) NOT NULL PRIMARY KEY,
        SERVER_ID VARCHAR(255) NOT NULL,
        ACQUIRED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        RENEWED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        EXPIRES_AT TIMESTAMP NOT NULL,
        INDEX idx_polling_server (SERVER_ID),
        INDEX idx_polling_expires (EXPIRES_AT)
      ) ENGINE=InnoDB
    `);
  });
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
  logger.info('Seeding default data...');

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

      logger.info('Created default admin user');
    }

    // Insert schema version (INSERT IGNORE for idempotency)
    await connection.query(`INSERT IGNORE INTO SCHEMA_INFO (VERSION) VALUES ('3.9.1')`);

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
      await connection.query(`INSERT IGNORE INTO SCRIPT (GROUP_ID, ID, SCRIPT) VALUES (?, ?, ?)`, [
        groupId,
        id,
        script,
      ]);
    }

    logger.info('Default configuration seeded');
  });
}

/**
 * Ensure channel-specific message tables exist
 *
 * 1. Registers channel in D_CHANNELS table
 * 2. Creates D_M{channelId}, D_MM{channelId}, etc. tables
 */
export async function ensureChannelTables(channelId: string): Promise<void> {
  logger.info(`Ensuring channel tables for ${channelId}...`);

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

  logger.info(`Channel tables ensured for ${channelId}`);
}

// Built-in columns in D_MCM tables that should never be added/dropped/modified
const BUILTIN_MCM_COLUMNS = new Set(['MESSAGE_ID', 'METADATA_ID']);

// Map MetaDataColumnType to MySQL column type
function metaDataTypeToSql(type: MetaDataColumnType | string): string {
  switch (type) {
    case MetaDataColumnType.STRING:
    case 'STRING':
      return 'VARCHAR(255)';
    case MetaDataColumnType.NUMBER:
    case 'NUMBER':
      return 'DECIMAL(31, 15)';
    case MetaDataColumnType.BOOLEAN:
    case 'BOOLEAN':
      return 'TINYINT(1)';
    case MetaDataColumnType.TIMESTAMP:
    case 'TIMESTAMP':
      return 'DATETIME';
    default:
      return 'VARCHAR(255)';
  }
}

// Normalize MySQL column types for comparison (e.g. "varchar(255)" → "VARCHAR(255)")
function normalizeSqlType(rawType: string): string {
  const upper = rawType.toUpperCase().trim();
  // MySQL's INFORMATION_SCHEMA reports "int" not "int(11)", "decimal(31,15)" etc.
  // Normalize common variants
  if (upper === 'INT' || upper === 'TINYINT') return upper;
  return upper;
}

interface ColumnInfoRow extends RowDataPacket {
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
}

/**
 * Column definition accepted by ensureMetaDataColumns.
 * Accepts both MetaDataColumn (enum type) and MetaDataColumnConfig (string type).
 */
interface MetaDataColumnDef {
  name: string;
  type: MetaDataColumnType | string;
  mappingName: string;
}

/**
 * Ensure custom metadata columns match the desired column definitions.
 * Compares existing D_MCM columns against desired columns and runs
 * ALTER TABLE ADD/DROP/MODIFY as needed.
 *
 * Matches Java Mirth behavior: on redeploy, metadata columns are synced
 * to match the channel configuration.
 *
 * @param channelId - Channel ID (used for table name D_MCM{channelId})
 * @param columns - Desired metadata column definitions
 */
export async function ensureMetaDataColumns(
  channelId: string,
  columns: MetaDataColumnDef[]
): Promise<void> {
  const tableName = `D_MCM${validateChannelId(channelId)}`;
  const pool = getPool();

  // Query existing columns from information_schema
  const [existingRows] = await pool.query<ColumnInfoRow[]>(
    `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [tableName]
  );

  // Build map of existing custom columns (exclude built-in MESSAGE_ID, METADATA_ID)
  const existingColumns = new Map<string, string>();
  for (const row of existingRows) {
    if (!BUILTIN_MCM_COLUMNS.has(row.COLUMN_NAME.toUpperCase())) {
      existingColumns.set(row.COLUMN_NAME.toUpperCase(), normalizeSqlType(row.COLUMN_TYPE));
    }
  }

  // Build map of desired columns
  const desiredColumns = new Map<string, { name: string; sqlType: string }>();
  for (const col of columns) {
    desiredColumns.set(col.name.toUpperCase(), {
      name: col.name,
      sqlType: metaDataTypeToSql(col.type),
    });
  }

  // Determine columns to add, drop, and modify
  const toAdd: { name: string; sqlType: string }[] = [];
  const toDrop: string[] = [];
  const toModify: { name: string; sqlType: string }[] = [];

  // Columns in desired but not in existing → ADD
  for (const [upperName, desired] of desiredColumns) {
    if (!existingColumns.has(upperName)) {
      toAdd.push(desired);
    } else {
      // Column exists — check if type changed
      const existingType = existingColumns.get(upperName)!;
      const desiredType = normalizeSqlType(desired.sqlType);
      if (existingType !== desiredType) {
        toModify.push(desired);
      }
    }
  }

  // Columns in existing but not in desired → DROP
  for (const [upperName] of existingColumns) {
    if (!desiredColumns.has(upperName)) {
      toDrop.push(upperName);
    }
  }

  // Execute ALTER TABLE statements
  for (const col of toAdd) {
    await pool.execute(
      `ALTER TABLE ${tableName} ADD COLUMN \`${col.name}\` ${col.sqlType}`
    );
    logger.debug(`Added metadata column \`${col.name}\` (${col.sqlType}) to ${tableName}`);
  }

  for (const colName of toDrop) {
    await pool.execute(
      `ALTER TABLE ${tableName} DROP COLUMN \`${colName}\``
    );
    logger.debug(`Dropped metadata column \`${colName}\` from ${tableName}`);
  }

  for (const col of toModify) {
    await pool.execute(
      `ALTER TABLE ${tableName} MODIFY COLUMN \`${col.name}\` ${col.sqlType}`
    );
    logger.debug(`Modified metadata column \`${col.name}\` to ${col.sqlType} in ${tableName}`);
  }

  if (toAdd.length > 0 || toDrop.length > 0 || toModify.length > 0) {
    logger.info(
      `Synced metadata columns for ${tableName}: +${toAdd.length} -${toDrop.length} ~${toModify.length}`
    );
  }
}

/**
 * Check if channel tables exist
 *
 * Re-exports from DonkeyDao for convenience
 */
export async function channelTablesExist(channelId: string): Promise<boolean> {
  return donkeyChannelTablesExist(channelId);
}
