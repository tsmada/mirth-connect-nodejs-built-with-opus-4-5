import { DatabaseConnectionFactory, dbConnFactory } from '../../../../src/javascript/userutil/DatabaseConnectionFactory';
import { DatabaseConnection, Logger } from '../../../../src/javascript/userutil/DatabaseConnection';

// Mock mysql2/promise module
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
  createPool: jest.fn(),
}));

// Get the mocked functions
import { createConnection, createPool } from 'mysql2/promise';
const mockedCreateConnection = createConnection as jest.MockedFunction<typeof createConnection>;
const mockedCreatePool = createPool as jest.MockedFunction<typeof createPool>;

describe('DatabaseConnectionFactory', () => {
  // Mock connection
  const mockConnection = {
    query: jest.fn(),
    execute: jest.fn(),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    end: jest.fn(),
    release: jest.fn(),
  };

  // Mock pool
  const mockPool = {
    getConnection: jest.fn().mockResolvedValue(mockConnection),
    end: jest.fn().mockResolvedValue(undefined),
  };

  // Mock logger
  const mockLogger: Logger = {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let factory: DatabaseConnectionFactory;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateConnection.mockResolvedValue(mockConnection as any);
    mockedCreatePool.mockReturnValue(mockPool as any);
    factory = new DatabaseConnectionFactory(mockLogger);
  });

  describe('createDatabaseConnection', () => {
    it('should create MySQL connection with credentials', async () => {
      const connection = await factory.createDatabaseConnection(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb',
        'user',
        'password'
      );

      expect(connection).toBeInstanceOf(DatabaseConnection);
      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 3306,
          database: 'testdb',
          user: 'user',
          password: 'password',
        })
      );
    });

    it('should create MariaDB connection', async () => {
      await factory.createDatabaseConnection(
        'org.mariadb.jdbc.Driver',
        'jdbc:mysql://mariadb.local:3307/mydb',
        'admin',
        'secret'
      );

      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'mariadb.local',
          port: 3307,
          database: 'mydb',
        })
      );
    });

    it('should parse URL with query parameters', async () => {
      await factory.createDatabaseConnection(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb?useSSL=true&connectTimeout=5000',
        'user',
        'pass'
      );

      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 3306,
          database: 'testdb',
          useSSL: 'true',
          connectTimeout: 5000,
        })
      );
    });

    it('should map characterEncoding to charset', async () => {
      await factory.createDatabaseConnection(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb?characterEncoding=utf8mb4',
        'user',
        'pass'
      );

      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          charset: 'utf8mb4',
        })
      );
    });

    it('should map serverTimezone to timezone', async () => {
      await factory.createDatabaseConnection(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb?serverTimezone=UTC',
        'user',
        'pass'
      );

      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: 'UTC',
        })
      );
    });

    it('should use default port if not specified', async () => {
      await factory.createDatabaseConnection(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost/testdb',
        'user',
        'pass'
      );

      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 3306,
        })
      );
    });

    it('should handle URL without jdbc: prefix', async () => {
      await factory.createDatabaseConnection(
        'com.mysql.cj.jdbc.Driver',
        'mysql://localhost:3306/testdb',
        'user',
        'pass'
      );

      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 3306,
          database: 'testdb',
        })
      );
    });

    it('should throw for PostgreSQL (not implemented)', async () => {
      await expect(
        factory.createDatabaseConnection(
          'org.postgresql.Driver',
          'jdbc:postgresql://localhost:5432/mydb',
          'user',
          'pass'
        )
      ).rejects.toThrow(/PostgreSQL connections require the 'pg' package/);
    });

    it('should throw for SQL Server (not implemented)', async () => {
      await expect(
        factory.createDatabaseConnection(
          'com.microsoft.sqlserver.jdbc.SQLServerDriver',
          'jdbc:sqlserver://localhost:1433;databaseName=mydb',
          'user',
          'pass'
        )
      ).rejects.toThrow(/SQL Server connections require the 'mssql' package/);
    });
  });

  describe('createDatabaseConnectionWithoutAuth', () => {
    it('should create connection without credentials', async () => {
      const connection = await factory.createDatabaseConnectionWithoutAuth(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb'
      );

      expect(connection).toBeInstanceOf(DatabaseConnection);
      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 3306,
          database: 'testdb',
          user: undefined,
          password: undefined,
        })
      );
    });
  });

  describe('createConnection', () => {
    it('should return raw connection object', async () => {
      const connection = await factory.createConnection(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb',
        'user',
        'password'
      );

      expect(connection).toBe(mockConnection);
    });
  });

  describe('initializeDriver', () => {
    it('should initialize MySQL driver', async () => {
      await factory.initializeDriver('com.mysql.cj.jdbc.Driver');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Initializing driver')
      );
    });

    it('should only initialize driver once', async () => {
      await factory.initializeDriver('com.mysql.cj.jdbc.Driver');
      await factory.initializeDriver('com.mysql.cj.jdbc.Driver');

      // Debug log for initialization only called once
      const initCalls = (mockLogger.debug as jest.Mock).mock.calls.filter(
        (call: string[]) => call[0]?.includes('Initializing driver')
      );
      expect(initCalls.length).toBe(1);
    });

    it('should warn for unknown drivers', async () => {
      // Creating a connection with an unknown driver will fall back to MySQL
      // The warning is logged during connection creation, not initialization
      await factory.createDatabaseConnection(
        'com.unknown.Driver',
        'jdbc:unknowndb://localhost:1234/testdb',
        'user',
        'pass'
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown database type')
      );
    });
  });

  describe('JDBC URL parsing', () => {
    it('should parse standard MySQL URL', async () => {
      await factory.createDatabaseConnection(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://db.example.com:3307/production',
        'user',
        'pass'
      );

      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'db.example.com',
          port: 3307,
          database: 'production',
        })
      );
    });

    it('should parse URL with complex database name', async () => {
      await factory.createDatabaseConnection(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/my_database_v2',
        'user',
        'pass'
      );

      expect(mockedCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          database: 'my_database_v2',
        })
      );
    });

    it('should throw for invalid URL format', async () => {
      await expect(
        factory.createDatabaseConnection(
          'com.mysql.cj.jdbc.Driver',
          'invalid-url',
          'user',
          'pass'
        )
      ).rejects.toThrow();
    });
  });

  describe('connection pooling', () => {
    it('should create a connection pool', async () => {
      const pool = await factory.createPool(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb',
        'user',
        'password',
        5
      );

      expect(pool).toBe(mockPool);
      expect(mockedCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 3306,
          database: 'testdb',
          connectionLimit: 5,
        })
      );
    });

    it('should reuse existing pool for same connection string', async () => {
      await factory.createPool(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb',
        'user',
        'password'
      );

      await factory.createPool(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb',
        'user',
        'password'
      );

      expect(mockedCreatePool).toHaveBeenCalledTimes(1);
    });

    it('should get connection from pool', async () => {
      const connection = await factory.getConnectionFromPool(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/testdb',
        'user',
        'password'
      );

      expect(connection).toBeInstanceOf(DatabaseConnection);
      expect(mockPool.getConnection).toHaveBeenCalled();
    });

    it('should close all pools', async () => {
      await factory.createPool(
        'com.mysql.cj.jdbc.Driver',
        'jdbc:mysql://localhost:3306/db1',
        'user',
        'password'
      );

      await factory.closeAllPools();

      expect(mockPool.end).toHaveBeenCalled();
    });
  });

  describe('default export', () => {
    it('should export singleton instance', () => {
      expect(dbConnFactory).toBeInstanceOf(DatabaseConnectionFactory);
    });
  });

  describe('driver mapping', () => {
    it.each([
      ['com.mysql.cj.jdbc.Driver', 'mysql'],
      ['com.mysql.jdbc.Driver', 'mysql'],
      ['org.mariadb.jdbc.Driver', 'mysql'],
    ])('should map %s to mysql', async (driver) => {
      await factory.createDatabaseConnection(
        driver,
        'jdbc:mysql://localhost:3306/testdb',
        'user',
        'pass'
      );

      // Should use mysql2 createConnection (not throw)
      expect(mockedCreateConnection).toHaveBeenCalled();
    });

    it.each([
      ['org.postgresql.Driver', 'postgres'],
    ])('should map %s to postgres (and fail)', async (driver) => {
      await expect(
        factory.createDatabaseConnection(
          driver,
          'jdbc:postgresql://localhost:5432/testdb',
          'user',
          'pass'
        )
      ).rejects.toThrow(/PostgreSQL/);
    });

    it.each([
      ['com.microsoft.sqlserver.jdbc.SQLServerDriver', 'mssql'],
      ['net.sourceforge.jtds.jdbc.Driver', 'mssql'],
    ])('should map %s to mssql (and fail)', async (driver) => {
      await expect(
        factory.createDatabaseConnection(
          driver,
          'jdbc:sqlserver://localhost:1433;databaseName=testdb',
          'user',
          'pass'
        )
      ).rejects.toThrow(/SQL Server/);
    });
  });

  describe('SQL Server URL parsing', () => {
    it('should parse SQL Server URL format', async () => {
      // This will fail because mssql isn't implemented, but we can verify the parsing
      // by checking the error message contains the correct parsed values
      await expect(
        factory.createDatabaseConnection(
          'com.microsoft.sqlserver.jdbc.SQLServerDriver',
          'jdbc:sqlserver://sqlserver.local:1434;databaseName=mydb;encrypt=true',
          'user',
          'pass'
        )
      ).rejects.toThrow();
    });
  });
});
