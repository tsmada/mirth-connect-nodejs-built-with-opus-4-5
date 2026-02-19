/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/DatabaseConnectionFactory.java
 *
 * Purpose: Create database connections from Mirth Connect scripts.
 *
 * Key behaviors to replicate:
 * - createDatabaseConnection(driver, address, username, password) - returns DatabaseConnection
 * - createDatabaseConnection(driver, address) - returns DatabaseConnection without auth
 * - createConnection(driver, address, username, password) - returns raw connection
 * - initializeDriver(driver) - for JavaScript context compatibility
 *
 * Design note: Java uses JDBC drivers which are all accessed via the same interface.
 * In Node.js, different databases require different npm packages (mysql2, pg, mssql, etc.)
 * This factory handles the mapping and provides a unified interface.
 */

import { createConnection, createPool, Pool, Connection } from 'mysql2/promise';
import { DatabaseConnection, Logger } from './DatabaseConnection.js';

/** Default logger for the factory */
const defaultLogger: Logger = {
  debug: (msg: string) => {
    if (process.env.DEBUG) {
      console.debug(`[DatabaseConnectionFactory] ${msg}`);
    }
  },
  warn: (msg: string | Error) => console.warn(`[DatabaseConnectionFactory] ${msg}`),
  error: (msg: string, err?: Error) =>
    console.error(`[DatabaseConnectionFactory] ${msg}`, err || ''),
};

/**
 * Parsed JDBC URL components.
 */
interface JdbcUrlComponents {
  driver: string;
  host: string;
  port: number;
  database: string;
  params: Record<string, string>;
}

/**
 * Driver information cache entry.
 */
interface DriverInfo {
  initialized: boolean;
  pool?: Pool;
}

/**
 * Factory for creating database connections.
 *
 * This class provides methods to create DatabaseConnection objects from
 * JDBC-style connection strings. It supports MySQL/MariaDB natively, with
 * PostgreSQL and MSSQL support available via connection string translation.
 *
 * @example
 * ```typescript
 * // Create a factory instance
 * const factory = new DatabaseConnectionFactory();
 *
 * // Create a database connection
 * const dbConn = await factory.createDatabaseConnection(
 *   'com.mysql.cj.jdbc.Driver',
 *   'jdbc:mysql://localhost:3306/mydb',
 *   'user',
 *   'password'
 * );
 *
 * // Use the connection
 * const result = await dbConn.executeCachedQuery('SELECT * FROM users');
 *
 * // Close when done
 * await dbConn.close();
 * ```
 */
export class DatabaseConnectionFactory {
  private driverInfoMap: Map<string, DriverInfo> = new Map();
  private logger: Logger;

  /** Map of JDBC driver class names to database types */
  private static readonly DRIVER_MAP: Record<string, string> = {
    // MySQL drivers
    'com.mysql.cj.jdbc.Driver': 'mysql',
    'com.mysql.jdbc.Driver': 'mysql',
    'org.mariadb.jdbc.Driver': 'mysql',

    // PostgreSQL drivers
    'org.postgresql.Driver': 'postgres',

    // Microsoft SQL Server drivers
    'com.microsoft.sqlserver.jdbc.SQLServerDriver': 'mssql',
    'net.sourceforge.jtds.jdbc.Driver': 'mssql',

    // Oracle drivers
    'oracle.jdbc.driver.OracleDriver': 'oracle',
    'oracle.jdbc.OracleDriver': 'oracle',

    // Generic/Other
    'org.h2.Driver': 'h2',
    'org.sqlite.JDBC': 'sqlite',
  };

  constructor(logger: Logger = defaultLogger) {
    this.logger = logger;
  }

  /**
   * Creates a DatabaseConnection with authentication credentials.
   *
   * @param driver - The JDBC driver class name
   * @param address - The JDBC connection URL
   * @param username - The database username
   * @param password - The database password
   * @returns A new DatabaseConnection
   */
  async createDatabaseConnection(
    driver: string,
    address: string,
    username: string,
    password: string
  ): Promise<DatabaseConnection> {
    await this.initializeDriver(driver);

    const parsed = this.parseJdbcUrl(address);
    const connection = await this.createNativeConnection(parsed, username, password);

    return new DatabaseConnection(connection, address, this.logger);
  }

  /**
   * Creates a DatabaseConnection without authentication.
   * Useful for databases with integrated/trusted authentication.
   *
   * @param driver - The JDBC driver class name
   * @param address - The JDBC connection URL
   * @returns A new DatabaseConnection
   */
  async createDatabaseConnectionWithoutAuth(
    driver: string,
    address: string
  ): Promise<DatabaseConnection> {
    await this.initializeDriver(driver);

    const parsed = this.parseJdbcUrl(address);
    const connection = await this.createNativeConnection(parsed);

    return new DatabaseConnection(connection, address, this.logger);
  }

  /**
   * Creates a raw database connection (not wrapped in DatabaseConnection).
   * This is useful when you need direct access to the underlying connection.
   *
   * @param driver - The JDBC driver class name
   * @param address - The JDBC connection URL
   * @param username - The database username
   * @param password - The database password
   * @returns The raw connection object
   */
  async createConnection(
    driver: string,
    address: string,
    username: string,
    password: string
  ): Promise<Connection> {
    await this.initializeDriver(driver);

    const parsed = this.parseJdbcUrl(address);
    return this.createNativeConnection(parsed, username, password);
  }

  /**
   * Initializes the specified JDBC driver.
   * In Java, this loads the driver class. In Node.js, we verify the
   * corresponding npm package is available and initialize any connection pools.
   *
   * @param driver - The JDBC driver class name
   */
  async initializeDriver(driver: string): Promise<void> {
    let driverInfo = this.driverInfoMap.get(driver);

    if (!driverInfo) {
      driverInfo = { initialized: false };
      this.driverInfoMap.set(driver, driverInfo);
    }

    if (driverInfo.initialized) {
      return;
    }

    const dbType = this.getDbType(driver);
    this.logger.debug(`Initializing driver: ${driver} (type: ${dbType})`);

    // Verify the appropriate package is available
    try {
      switch (dbType) {
        case 'mysql':
          // mysql2 is our default and should be available
          require.resolve('mysql2');
          break;
        case 'postgres':
          // pg package needed for PostgreSQL
          require.resolve('pg');
          break;
        case 'mssql':
          // mssql package needed for SQL Server
          require.resolve('mssql');
          break;
        default:
          this.logger.warn(`Unknown database type for driver: ${driver}, defaulting to MySQL`);
      }
    } catch (error) {
      this.logger.warn(`Driver package not available for ${driver}: ${(error as Error).message}`);
    }

    driverInfo.initialized = true;
  }

  /**
   * Gets the database type for a JDBC driver class.
   */
  private getDbType(driver: string): string {
    return DatabaseConnectionFactory.DRIVER_MAP[driver] || 'mysql';
  }

  /**
   * Parses a JDBC URL into its components.
   * Supports formats like:
   * - jdbc:mysql://host:port/database
   * - jdbc:mysql://host:port/database?param=value
   * - jdbc:postgresql://host:port/database
   * - jdbc:sqlserver://host:port;databaseName=db
   */
  private parseJdbcUrl(url: string): JdbcUrlComponents {
    // Remove 'jdbc:' prefix if present
    let cleanUrl = url.startsWith('jdbc:') ? url.substring(5) : url;

    // Extract driver type
    const colonIndex = cleanUrl.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid JDBC URL format: ${url}`);
    }

    const driver = cleanUrl.substring(0, colonIndex);
    cleanUrl = cleanUrl.substring(colonIndex + 1);

    // Remove leading slashes
    while (cleanUrl.startsWith('/')) {
      cleanUrl = cleanUrl.substring(1);
    }

    // Parse host, port, database, and params
    let host = 'localhost';
    let port = this.getDefaultPort(driver);
    let database = '';
    const params: Record<string, string> = {};

    // Handle SQL Server format: host:port;databaseName=db;param=value
    if (driver.includes('sqlserver')) {
      const parts = cleanUrl.split(';');
      const hostPart = parts[0] || '';

      if (hostPart.includes(':')) {
        const [h, p] = hostPart.split(':');
        host = h || 'localhost';
        port = parseInt(p || '1433', 10);
      } else {
        host = hostPart || 'localhost';
      }

      // Parse parameters
      for (let i = 1; i < parts.length; i++) {
        const param = parts[i];
        if (param) {
          const eqIndex = param.indexOf('=');
          if (eqIndex > 0) {
            const key = param.substring(0, eqIndex);
            const value = param.substring(eqIndex + 1);
            if (key.toLowerCase() === 'databasename') {
              database = value;
            } else {
              params[key] = value;
            }
          }
        }
      }
    } else {
      // Standard format: host:port/database?params
      const queryIndex = cleanUrl.indexOf('?');
      let pathPart = cleanUrl;

      if (queryIndex !== -1) {
        pathPart = cleanUrl.substring(0, queryIndex);
        const queryString = cleanUrl.substring(queryIndex + 1);

        // Parse query parameters
        queryString.split('&').forEach((param) => {
          const eqIndex = param.indexOf('=');
          if (eqIndex > 0) {
            params[param.substring(0, eqIndex)] = param.substring(eqIndex + 1);
          }
        });
      }

      // Parse host:port/database
      const slashIndex = pathPart.indexOf('/');
      let hostPort = pathPart;

      if (slashIndex !== -1) {
        hostPort = pathPart.substring(0, slashIndex);
        database = pathPart.substring(slashIndex + 1);
      }

      if (hostPort.includes(':')) {
        const [h, p] = hostPort.split(':');
        host = h || 'localhost';
        port = parseInt(p || String(this.getDefaultPort(driver)), 10);
      } else {
        host = hostPort || 'localhost';
      }
    }

    return { driver, host, port, database, params };
  }

  /**
   * Gets the default port for a database type.
   */
  private getDefaultPort(driver: string): number {
    switch (driver.toLowerCase()) {
      case 'mysql':
      case 'mariadb':
        return 3306;
      case 'postgresql':
      case 'postgres':
        return 5432;
      case 'sqlserver':
        return 1433;
      case 'oracle':
        return 1521;
      default:
        return 3306;
    }
  }

  /**
   * Creates a native database connection using the appropriate driver.
   */
  private async createNativeConnection(
    parsed: JdbcUrlComponents,
    username?: string,
    password?: string
  ): Promise<Connection> {
    const dbType = parsed.driver.toLowerCase();

    switch (dbType) {
      case 'mysql':
      case 'mariadb':
        return this.createMySqlConnection(parsed, username, password);

      case 'postgresql':
      case 'postgres':
        return this.createPostgresConnection(parsed, username, password);

      case 'sqlserver':
        return this.createMsSqlConnection(parsed, username, password);

      default:
        // Default to MySQL
        this.logger.warn(`Unknown database type: ${dbType}, attempting MySQL connection`);
        return this.createMySqlConnection(parsed, username, password);
    }
  }

  /**
   * Creates a MySQL/MariaDB connection.
   */
  private async createMySqlConnection(
    parsed: JdbcUrlComponents,
    username?: string,
    password?: string
  ): Promise<Connection> {
    const config: Record<string, unknown> = {
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      user: username,
      password: password,
      // Common MySQL options
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    };

    // Add any query parameters from the URL
    for (const [key, value] of Object.entries(parsed.params)) {
      // Map common JDBC params to mysql2 params
      switch (key.toLowerCase()) {
        case 'useunicode':
          // Already handled by mysql2
          break;
        case 'characterencoding':
          config.charset = value;
          break;
        case 'servertimezone':
          config.timezone = value;
          break;
        case 'connecttimeout':
          config.connectTimeout = parseInt(value, 10);
          break;
        default:
          config[key] = value;
      }
    }

    this.logger.debug(
      `Creating MySQL connection to ${parsed.host}:${parsed.port}/${parsed.database}`
    );

    return createConnection(config);
  }

  /**
   * Creates a PostgreSQL connection.
   * Note: Requires 'pg' package to be installed.
   */
  private async createPostgresConnection(
    parsed: JdbcUrlComponents,
    username?: string,
    _password?: string
  ): Promise<Connection> {
    // PostgreSQL requires the 'pg' package
    // For now, throw an error with instructions
    throw new Error(
      `PostgreSQL connections require the 'pg' package. ` +
        `Install it with: npm install pg\n` +
        `Connection string: postgresql://${username}@${parsed.host}:${parsed.port}/${parsed.database}`
    );
  }

  /**
   * Creates a Microsoft SQL Server connection.
   * Note: Requires 'mssql' package to be installed.
   */
  private async createMsSqlConnection(
    parsed: JdbcUrlComponents,
    username?: string,
    _password?: string
  ): Promise<Connection> {
    // MSSQL requires the 'mssql' package
    throw new Error(
      `SQL Server connections require the 'mssql' package. ` +
        `Install it with: npm install mssql\n` +
        `Connection string: Server=${parsed.host},${parsed.port};Database=${parsed.database};User Id=${username}`
    );
  }

  /**
   * Creates a connection pool for the given driver and address.
   * Pools are cached and reused for subsequent connections.
   */
  async createPool(
    driver: string,
    address: string,
    username: string,
    password: string,
    poolSize = 10
  ): Promise<Pool> {
    await this.initializeDriver(driver);

    const parsed = this.parseJdbcUrl(address);
    const poolKey = `${driver}:${address}:${username}`;

    let driverInfo = this.driverInfoMap.get(poolKey);
    if (driverInfo?.pool) {
      return driverInfo.pool;
    }

    const pool = createPool({
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      user: username,
      password: password,
      waitForConnections: true,
      connectionLimit: poolSize,
      queueLimit: 0,
    });

    if (!driverInfo) {
      driverInfo = { initialized: true };
    }
    driverInfo.pool = pool;
    this.driverInfoMap.set(poolKey, driverInfo);

    return pool;
  }

  /**
   * Gets a connection from a pool, wrapped in a DatabaseConnection.
   */
  async getConnectionFromPool(
    driver: string,
    address: string,
    username: string,
    password: string
  ): Promise<DatabaseConnection> {
    const pool = await this.createPool(driver, address, username, password);
    const connection = await pool.getConnection();
    return DatabaseConnection.fromPool(pool, connection, address, this.logger);
  }

  /**
   * Closes all connection pools managed by this factory.
   */
  async closeAllPools(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const driverInfo of this.driverInfoMap.values()) {
      if (driverInfo.pool) {
        promises.push(driverInfo.pool.end());
      }
    }

    await Promise.all(promises);
    this.driverInfoMap.clear();
  }
}

/**
 * Singleton instance of DatabaseConnectionFactory for convenience.
 * Most scripts can use this instead of creating their own factory.
 */
export const dbConnFactory = new DatabaseConnectionFactory();
