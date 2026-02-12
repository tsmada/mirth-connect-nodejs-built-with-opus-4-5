import { DatabaseDispatcher } from '../../../../src/connectors/jdbc/DatabaseDispatcher';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Note: Full integration tests require a MySQL database
// These tests focus on configuration and property handling

describe('DatabaseDispatcher', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Test DB Dispatcher',
        metaDataId: 1,
      });

      expect(dispatcher.getName()).toBe('Test DB Dispatcher');
      expect(dispatcher.getMetaDataId()).toBe(1);
      expect(dispatcher.getTransportName()).toBe('JDBC');
      expect(dispatcher.isRunning()).toBe(false);

      const props = dispatcher.getProperties();
      expect(props.driver).toBe('Please Select One');
      expect(props.url).toBe('');
      expect(props.useScript).toBe(false);
    });

    it('should create with custom values', () => {
      const dispatcher = new DatabaseDispatcher({
        name: 'Custom DB Dispatcher',
        metaDataId: 2,
        properties: {
          url: 'jdbc:mysql://localhost:3306/testdb',
          username: 'root',
          password: 'secret',
          query: 'INSERT INTO messages (data) VALUES (?)',
          parameters: ['test data'],
        },
      });

      const props = dispatcher.getProperties();
      expect(props.url).toBe('jdbc:mysql://localhost:3306/testdb');
      expect(props.username).toBe('root');
      expect(props.password).toBe('secret');
      expect(props.query).toBe('INSERT INTO messages (data) VALUES (?)');
      expect(props.parameters).toEqual(['test data']);
    });
  });

  describe('properties', () => {
    let dispatcher: DatabaseDispatcher;

    beforeEach(() => {
      dispatcher = new DatabaseDispatcher({ metaDataId: 1 });
    });

    it('should get default properties', () => {
      const props = dispatcher.getProperties();

      expect(props.driver).toBe('Please Select One');
      expect(props.url).toBe('');
      expect(props.username).toBe('');
      expect(props.password).toBe('');
      expect(props.query).toBe('');
      expect(props.useScript).toBe(false);
      expect(props.parameters).toEqual([]);
    });

    it('should update properties', () => {
      dispatcher.setProperties({
        url: 'jdbc:mysql://newhost/newdb',
        query: 'UPDATE messages SET status = ?',
        parameters: ['processed'],
      });

      const props = dispatcher.getProperties();
      expect(props.url).toBe('jdbc:mysql://newhost/newdb');
      expect(props.query).toBe('UPDATE messages SET status = ?');
      expect(props.parameters).toEqual(['processed']);
    });
  });

  describe('lifecycle without database', () => {
    let dispatcher: DatabaseDispatcher;

    beforeEach(() => {
      dispatcher = new DatabaseDispatcher({
        metaDataId: 1,
        properties: {
          url: '', // Empty URL will cause connection to fail
        },
      });
    });

    it('should be stopped initially', () => {
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should fail to start without valid URL', async () => {
      await expect(dispatcher.start()).rejects.toThrow();
    });

    it('should not fail when stopping a stopped dispatcher', async () => {
      await dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });
  });

  describe('query configuration', () => {
    it('should configure INSERT query', () => {
      const dispatcher = new DatabaseDispatcher({
        metaDataId: 1,
        properties: {
          useScript: false,
          query: 'INSERT INTO messages (id, data, timestamp) VALUES (?, ?, NOW())',
          parameters: [1, 'test data'],
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useScript).toBe(false);
      expect(props.query).toContain('INSERT');
      expect(props.parameters).toHaveLength(2);
    });

    it('should configure UPDATE query', () => {
      const dispatcher = new DatabaseDispatcher({
        metaDataId: 1,
        properties: {
          query: 'UPDATE messages SET processed = 1 WHERE id = ?',
          parameters: [123],
        },
      });

      const props = dispatcher.getProperties();
      expect(props.query).toContain('UPDATE');
    });

    it('should configure DELETE query', () => {
      const dispatcher = new DatabaseDispatcher({
        metaDataId: 1,
        properties: {
          query: 'DELETE FROM messages WHERE id = ?',
          parameters: [456],
        },
      });

      const props = dispatcher.getProperties();
      expect(props.query).toContain('DELETE');
    });

    it('should configure script mode', () => {
      const dispatcher = new DatabaseDispatcher({
        metaDataId: 1,
        properties: {
          useScript: true,
          query: 'var result = dbConn.executeUpdate("INSERT INTO log (msg) VALUES (?)", [$("message")]); return result;',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useScript).toBe(true);
    });
  });

  describe('connection settings', () => {
    it('should configure database credentials', () => {
      const dispatcher = new DatabaseDispatcher({
        metaDataId: 1,
        properties: {
          driver: 'com.mysql.cj.jdbc.Driver',
          url: 'jdbc:mysql://db.example.com:3306/production',
          username: 'app_user',
          password: 'secure_password',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.driver).toBe('com.mysql.cj.jdbc.Driver');
      expect(props.url).toBe('jdbc:mysql://db.example.com:3306/production');
      expect(props.username).toBe('app_user');
      expect(props.password).toBe('secure_password');
    });
  });

  describe('destination connector options', () => {
    it('should configure queue settings', () => {
      const dispatcher = new DatabaseDispatcher({
        metaDataId: 1,
        queueEnabled: true,
        queueSendFirst: true,
        retryCount: 5,
        retryIntervalMillis: 15000,
      });

      expect(dispatcher.isQueueEnabled()).toBe(true);
    });

    it('should configure enabled state', () => {
      const dispatcher = new DatabaseDispatcher({
        metaDataId: 1,
        enabled: false,
      });

      expect(dispatcher.isEnabled()).toBe(false);
    });
  });
});
