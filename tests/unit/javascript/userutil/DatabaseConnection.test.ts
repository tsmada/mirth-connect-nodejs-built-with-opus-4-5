import { DatabaseConnection, Logger } from '../../../../src/javascript/userutil/DatabaseConnection';
import { MirthCachedRowSet } from '../../../../src/javascript/userutil/MirthCachedRowSet';

// Mock mysql2/promise module
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
  createPool: jest.fn(),
}));

describe('DatabaseConnection', () => {
  // Mock connection object
  const mockConnection = {
    query: jest.fn(),
    execute: jest.fn(),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    end: jest.fn(),
    release: jest.fn(),
  };

  // Mock logger
  const mockLogger: Logger = {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let dbConnection: DatabaseConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations to prevent test pollution
    mockConnection.query.mockReset();
    mockConnection.execute.mockReset();
    mockConnection.beginTransaction.mockReset();
    mockConnection.commit.mockReset();
    mockConnection.rollback.mockReset();
    mockConnection.end.mockReset();
    mockConnection.release.mockReset();

    // Set default mock resolutions (can be overridden in individual tests)
    mockConnection.query.mockResolvedValue([[], []]);
    mockConnection.execute.mockResolvedValue([[], []]);
    mockConnection.beginTransaction.mockResolvedValue(undefined);
    mockConnection.commit.mockResolvedValue(undefined);
    mockConnection.rollback.mockResolvedValue(undefined);
    mockConnection.end.mockResolvedValue(undefined);

    dbConnection = new DatabaseConnection(
      mockConnection as any,
      'jdbc:mysql://localhost:3306/testdb',
      mockLogger
    );
  });

  describe('constructor', () => {
    it('should create a connection with address', () => {
      expect(dbConnection.getAddress()).toBe('jdbc:mysql://localhost:3306/testdb');
    });

    it('should log creation', () => {
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Creating new database connection')
      );
    });

    it('should return underlying connection', () => {
      expect(dbConnection.getConnection()).toBe(mockConnection);
    });
  });

  describe('executeCachedQuery', () => {
    it('should execute a simple query', async () => {
      const mockRows = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];
      const mockFields = [
        { name: 'id', type: 'INT' },
        { name: 'name', type: 'VARCHAR' },
      ];
      mockConnection.query.mockResolvedValue([mockRows, mockFields]);

      const result = await dbConnection.executeCachedQuery('SELECT * FROM users');

      expect(result).toBeInstanceOf(MirthCachedRowSet);
      expect(result.size()).toBe(2);
      expect(mockConnection.query).toHaveBeenCalledWith('SELECT * FROM users');
    });

    it('should execute a prepared query with parameters', async () => {
      const mockRows = [{ id: 1, name: 'Alice' }];
      const mockFields = [
        { name: 'id', type: 'INT' },
        { name: 'name', type: 'VARCHAR' },
      ];
      mockConnection.execute.mockResolvedValue([mockRows, mockFields]);

      const result = await dbConnection.executeCachedQuery(
        'SELECT * FROM users WHERE id = ?',
        [1]
      );

      expect(result).toBeInstanceOf(MirthCachedRowSet);
      expect(result.size()).toBe(1);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = ?',
        [1]
      );
    });

    it('should log query execution', async () => {
      mockConnection.query.mockResolvedValue([[], []]);

      await dbConnection.executeCachedQuery('SELECT 1');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Executing query')
      );
    });

    it('should log parameters', async () => {
      mockConnection.execute.mockResolvedValue([[], []]);

      await dbConnection.executeCachedQuery('SELECT * FROM users WHERE id = ?', [42]);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Adding parameter')
      );
    });

    it('should throw on query error', async () => {
      const error = new Error('Query failed');
      mockConnection.query.mockRejectedValue(error);

      await expect(dbConnection.executeCachedQuery('BAD QUERY')).rejects.toThrow(
        'Query failed'
      );
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should throw if connection is closed', async () => {
      await dbConnection.close();

      await expect(
        dbConnection.executeCachedQuery('SELECT 1')
      ).rejects.toThrow('Database connection is closed');
    });
  });

  describe('executeUpdate', () => {
    it('should execute an update statement', async () => {
      mockConnection.query.mockResolvedValue([{ affectedRows: 5 }]);

      const result = await dbConnection.executeUpdate('UPDATE users SET active = 1');

      expect(result).toBe(5);
      expect(mockConnection.query).toHaveBeenCalledWith('UPDATE users SET active = 1');
    });

    it('should execute a prepared update with parameters', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);

      const result = await dbConnection.executeUpdate(
        'UPDATE users SET name = ? WHERE id = ?',
        ['Alice', 1]
      );

      expect(result).toBe(1);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'UPDATE users SET name = ? WHERE id = ?',
        ['Alice', 1]
      );
    });

    it('should return -1 if query returns rows (SELECT)', async () => {
      mockConnection.query.mockResolvedValue([[{ id: 1 }], []]);

      const result = await dbConnection.executeUpdate('SELECT * FROM users');

      expect(result).toBe(-1);
    });

    it('should throw on update error', async () => {
      const error = new Error('Update failed');
      mockConnection.query.mockRejectedValue(error);

      await expect(
        dbConnection.executeUpdate('BAD UPDATE')
      ).rejects.toThrow('Update failed');
    });
  });

  describe('executeUpdateAndGetGeneratedKeys', () => {
    it('should execute insert and return generated key', async () => {
      mockConnection.query.mockResolvedValue([{ insertId: 42, affectedRows: 1 }]);

      const result = await dbConnection.executeUpdateAndGetGeneratedKeys(
        "INSERT INTO users (name) VALUES ('Alice')"
      );

      expect(result).toBeInstanceOf(MirthCachedRowSet);
      result.first();
      expect(result.getInt('GENERATED_KEY')).toBe(42);
    });

    it('should execute prepared insert with parameters', async () => {
      mockConnection.execute.mockResolvedValue([{ insertId: 100, affectedRows: 1 }]);

      const result = await dbConnection.executeUpdateAndGetGeneratedKeys(
        'INSERT INTO users (name, email) VALUES (?, ?)',
        ['Bob', 'bob@example.com']
      );

      result.first();
      expect(result.getInt('GENERATED_KEY')).toBe(100);
    });

    it('should return empty result if no generated key', async () => {
      mockConnection.query.mockResolvedValue([{ insertId: 0, affectedRows: 0 }]);

      const result = await dbConnection.executeUpdateAndGetGeneratedKeys(
        'INSERT INTO log (message) VALUES (?)'
      );

      expect(result.isEmpty()).toBe(true);
    });

    it('should throw on insert error', async () => {
      const error = new Error('Insert failed');
      mockConnection.query.mockRejectedValue(error);

      await expect(
        dbConnection.executeUpdateAndGetGeneratedKeys('BAD INSERT')
      ).rejects.toThrow('Insert failed');
    });
  });

  describe('transaction control', () => {
    describe('setAutoCommit', () => {
      it('should enable auto-commit', async () => {
        await dbConnection.setAutoCommit(true);

        expect(mockConnection.query).toHaveBeenCalledWith('SET autocommit = 1');
      });

      it('should disable auto-commit and start transaction', async () => {
        await dbConnection.setAutoCommit(false);

        expect(mockConnection.query).toHaveBeenCalledWith('SET autocommit = 0');
        expect(mockConnection.beginTransaction).toHaveBeenCalled();
      });
    });

    describe('commit', () => {
      it('should commit transaction', async () => {
        await dbConnection.commit();

        expect(mockConnection.commit).toHaveBeenCalled();
      });

      it('should throw if connection is closed', async () => {
        await dbConnection.close();

        await expect(dbConnection.commit()).rejects.toThrow(
          'Database connection is closed'
        );
      });
    });

    describe('rollback', () => {
      it('should rollback transaction', async () => {
        await dbConnection.rollback();

        expect(mockConnection.rollback).toHaveBeenCalled();
      });

      it('should throw if connection is closed', async () => {
        await dbConnection.close();

        await expect(dbConnection.rollback()).rejects.toThrow(
          'Database connection is closed'
        );
      });
    });
  });

  describe('close', () => {
    it('should close the connection', async () => {
      await dbConnection.close();

      expect(mockConnection.end).toHaveBeenCalled();
      expect(dbConnection.isClosed()).toBe(true);
      expect(dbConnection.getConnection()).toBeNull();
    });

    it('should be idempotent', async () => {
      await dbConnection.close();
      await dbConnection.close();

      expect(mockConnection.end).toHaveBeenCalledTimes(1);
    });

    it('should release to pool if from pool', async () => {
      const mockPool = {} as any;
      const poolConnection = DatabaseConnection.fromPool(
        mockPool,
        mockConnection as any,
        'jdbc:mysql://localhost:3306/testdb',
        mockLogger
      );

      await poolConnection.close();

      expect(mockConnection.release).toHaveBeenCalled();
      expect(mockConnection.end).not.toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      mockConnection.end.mockRejectedValue(new Error('Close failed'));

      await expect(dbConnection.close()).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('fromPool', () => {
    it('should create connection from pool', () => {
      const mockPool = {} as any;
      const poolConnection = DatabaseConnection.fromPool(
        mockPool,
        mockConnection as any,
        'jdbc:mysql://localhost:3306/testdb'
      );

      expect(poolConnection.getAddress()).toBe('jdbc:mysql://localhost:3306/testdb');
      expect(poolConnection.getConnection()).toBe(mockConnection);
    });
  });

  describe('integration scenarios', () => {
    it('should support typical CRUD workflow', async () => {
      // Create
      mockConnection.query.mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]);
      const insertResult = await dbConnection.executeUpdateAndGetGeneratedKeys(
        "INSERT INTO users (name) VALUES ('Alice')"
      );
      insertResult.first();
      expect(insertResult.getInt('GENERATED_KEY')).toBe(1);

      // Read
      mockConnection.query.mockResolvedValueOnce([
        [{ id: 1, name: 'Alice' }],
        [{ name: 'id' }, { name: 'name' }],
      ]);
      const selectResult = await dbConnection.executeCachedQuery(
        'SELECT * FROM users WHERE id = 1'
      );
      selectResult.first();
      expect(selectResult.getString('name')).toBe('Alice');

      // Update
      mockConnection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const updateCount = await dbConnection.executeUpdate(
        'UPDATE users SET name = ? WHERE id = ?',
        ['Alice Updated', 1]
      );
      expect(updateCount).toBe(1);

      // Delete
      mockConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const deleteCount = await dbConnection.executeUpdate(
        'DELETE FROM users WHERE id = 1'
      );
      expect(deleteCount).toBe(1);
    });

    it('should support transaction workflow', async () => {
      mockConnection.query.mockResolvedValue([{ affectedRows: 1 }]);

      await dbConnection.setAutoCommit(false);
      await dbConnection.executeUpdate("INSERT INTO accounts (balance) VALUES (100)");
      await dbConnection.executeUpdate("INSERT INTO accounts (balance) VALUES (200)");
      await dbConnection.commit();

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
    });

    it('should support transaction rollback on error', async () => {
      mockConnection.query
        .mockResolvedValueOnce([]) // SET autocommit
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // First insert
        .mockRejectedValueOnce(new Error('Constraint violation')); // Second insert fails

      await dbConnection.setAutoCommit(false);
      await dbConnection.executeUpdate("INSERT INTO accounts (balance) VALUES (100)");

      await expect(
        dbConnection.executeUpdate("INSERT INTO accounts (balance) VALUES (-100)")
      ).rejects.toThrow('Constraint violation');

      await dbConnection.rollback();
      expect(mockConnection.rollback).toHaveBeenCalled();
    });
  });
});
