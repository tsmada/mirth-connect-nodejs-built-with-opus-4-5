/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/DatabaseReceiverProperties.java
 *              ~/Projects/connect/server/src/com/mirth/connect/connectors/jdbc/DatabaseDispatcherProperties.java
 *
 * Purpose: Configuration properties for Database source and destination connectors
 *
 * Key behaviors to replicate:
 * - All configuration options from Java implementation
 * - Default values matching Java
 * - Support for query and script modes
 */

export enum UpdateMode {
  NEVER = 1,
  ONCE = 2,
  EACH = 3,
}

/**
 * Database Receiver (Source) Properties
 */
export interface DatabaseReceiverProperties {
  /** Database driver name */
  driver: string;
  /** JDBC URL */
  url: string;
  /** Database username */
  username: string;
  /** Database password */
  password: string;
  /** SELECT query or JavaScript */
  select: string;
  /** Post-process UPDATE query */
  update: string;
  /** Use JavaScript instead of SQL query */
  useScript: boolean;
  /** Aggregate all results into single message */
  aggregateResults: boolean;
  /** Cache results in memory */
  cacheResults: boolean;
  /** Keep connection open between polls */
  keepConnectionOpen: boolean;
  /** When to run update query */
  updateMode: UpdateMode;
  /** Number of connection retry attempts */
  retryCount: number;
  /** Retry interval in milliseconds */
  retryInterval: number;
  /** Number of rows to fetch at a time */
  fetchSize: number;
  /** Character encoding */
  encoding: string;
  /** Polling interval in milliseconds */
  pollInterval: number;
  /** Polling schedule (cron expression) */
  cronExpression?: string;
}

/**
 * Database Dispatcher (Destination) Properties
 */
export interface DatabaseDispatcherProperties {
  /** Database driver name */
  driver: string;
  /** JDBC URL */
  url: string;
  /** Database username */
  username: string;
  /** Database password */
  password: string;
  /** SQL query or JavaScript */
  query: string;
  /** Use JavaScript instead of SQL query */
  useScript: boolean;
  /** Query parameters */
  parameters?: unknown[];
}

/**
 * Default Database Receiver properties
 */
export function getDefaultDatabaseReceiverProperties(): DatabaseReceiverProperties {
  return {
    driver: 'Please Select One',
    url: '',
    username: '',
    password: '',
    select: '',
    update: '',
    useScript: false,
    aggregateResults: false,
    cacheResults: true,
    keepConnectionOpen: true,
    updateMode: UpdateMode.NEVER,
    retryCount: 3,
    retryInterval: 10000,
    fetchSize: 1000,
    encoding: 'UTF-8',
    pollInterval: 5000,
    cronExpression: undefined,
  };
}

/**
 * Default Database Dispatcher properties
 */
export function getDefaultDatabaseDispatcherProperties(): DatabaseDispatcherProperties {
  return {
    driver: 'Please Select One',
    url: '',
    username: '',
    password: '',
    query: '',
    useScript: false,
    parameters: [],
  };
}

/**
 * Connection configuration for MySQL2 driver
 */
export interface DatabaseConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  waitForConnections?: boolean;
  connectionLimit?: number;
  queueLimit?: number;
}

/**
 * Parse JDBC URL to extract connection parameters
 */
export function parseJdbcUrl(url: string): DatabaseConnectionConfig | null {
  // Handle MySQL JDBC URL format: jdbc:mysql://host:port/database
  const mysqlMatch = url.match(
    /^jdbc:mysql:\/\/([^:\/]+)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/i
  );

  if (mysqlMatch) {
    const [, host, port, database] = mysqlMatch;
    return {
      host: host || 'localhost',
      port: parseInt(port || '3306', 10),
      user: '',
      password: '',
      database: database || '',
    };
  }

  return null;
}

/**
 * Convert query result row to XML string
 */
export function rowToXml(row: Record<string, unknown>, _rowIndex?: number): string {
  const fields = Object.entries(row)
    .map(([key, value]) => {
      const escapedValue = escapeXml(String(value ?? ''));
      return `    <${key}>${escapedValue}</${key}>`;
    })
    .join('\n');

  return `  <result>\n${fields}\n  </result>`;
}

/**
 * Convert query results to XML string
 */
export function resultsToXml(rows: Record<string, unknown>[]): string {
  const results = rows.map((row, i) => rowToXml(row, i)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<results>\n${results}\n</results>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
