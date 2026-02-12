import { DatabaseReceiver } from '../../../../src/connectors/jdbc/DatabaseReceiver';
import { UpdateMode } from '../../../../src/connectors/jdbc/DatabaseConnectorProperties';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Note: Full integration tests require a MySQL database
// These tests focus on configuration and property handling

describe('DatabaseReceiver', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const receiver = new DatabaseReceiver({ name: 'Test DB Receiver' });

      expect(receiver.getName()).toBe('Test DB Receiver');
      expect(receiver.getTransportName()).toBe('JDBC');
      expect(receiver.isRunning()).toBe(false);

      const props = receiver.getProperties();
      expect(props.driver).toBe('Please Select One');
      expect(props.url).toBe('');
      expect(props.useScript).toBe(false);
    });

    it('should create with custom values', () => {
      const receiver = new DatabaseReceiver({
        name: 'Custom DB Receiver',
        properties: {
          url: 'jdbc:mysql://localhost:3306/testdb',
          username: 'root',
          password: 'secret',
          select: 'SELECT * FROM messages',
          update: 'UPDATE messages SET processed = 1',
          updateMode: UpdateMode.EACH,
          pollInterval: 10000,
        },
      });

      const props = receiver.getProperties();
      expect(props.url).toBe('jdbc:mysql://localhost:3306/testdb');
      expect(props.username).toBe('root');
      expect(props.password).toBe('secret');
      expect(props.select).toBe('SELECT * FROM messages');
      expect(props.update).toBe('UPDATE messages SET processed = 1');
      expect(props.updateMode).toBe(UpdateMode.EACH);
      expect(props.pollInterval).toBe(10000);
    });
  });

  describe('properties', () => {
    let receiver: DatabaseReceiver;

    beforeEach(() => {
      receiver = new DatabaseReceiver({});
    });

    it('should get default properties', () => {
      const props = receiver.getProperties();

      expect(props.aggregateResults).toBe(false);
      expect(props.cacheResults).toBe(true);
      expect(props.keepConnectionOpen).toBe(true);
      expect(props.retryCount).toBe(3);
      expect(props.retryInterval).toBe(10000);
      expect(props.fetchSize).toBe(1000);
      expect(props.encoding).toBe('UTF-8');
    });

    it('should update properties', () => {
      receiver.setProperties({
        url: 'jdbc:mysql://newhost/newdb',
        aggregateResults: true,
        keepConnectionOpen: false,
      });

      const props = receiver.getProperties();
      expect(props.url).toBe('jdbc:mysql://newhost/newdb');
      expect(props.aggregateResults).toBe(true);
      expect(props.keepConnectionOpen).toBe(false);
    });
  });

  describe('lifecycle without database', () => {
    let receiver: DatabaseReceiver;

    beforeEach(() => {
      receiver = new DatabaseReceiver({
        name: 'Test Receiver',
        properties: {
          url: '', // Empty URL will cause connection to fail
        },
      });
    });

    it('should be stopped initially', () => {
      expect(receiver.isRunning()).toBe(false);
    });

    it('should fail to start without valid URL', async () => {
      await expect(receiver.start()).rejects.toThrow();
    });

    it('should not fail when stopping a stopped receiver', async () => {
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);
    });
  });

  describe('query configuration', () => {
    it('should configure query mode', () => {
      const receiver = new DatabaseReceiver({
        properties: {
          useScript: false,
          select: 'SELECT id, data FROM messages WHERE processed = 0',
          update: 'UPDATE messages SET processed = 1 WHERE id = ?',
          updateMode: UpdateMode.EACH,
        },
      });

      const props = receiver.getProperties();
      expect(props.useScript).toBe(false);
      expect(props.select).toContain('SELECT');
      expect(props.update).toContain('UPDATE');
    });

    it('should configure script mode', () => {
      const receiver = new DatabaseReceiver({
        properties: {
          useScript: true,
          select: 'return dbConn.executeCachedQuery("SELECT * FROM messages");',
        },
      });

      const props = receiver.getProperties();
      expect(props.useScript).toBe(true);
    });
  });

  describe('update modes', () => {
    it('should set UPDATE_NEVER mode', () => {
      const receiver = new DatabaseReceiver({
        properties: { updateMode: UpdateMode.NEVER },
      });

      expect(receiver.getProperties().updateMode).toBe(UpdateMode.NEVER);
    });

    it('should set UPDATE_ONCE mode', () => {
      const receiver = new DatabaseReceiver({
        properties: { updateMode: UpdateMode.ONCE },
      });

      expect(receiver.getProperties().updateMode).toBe(UpdateMode.ONCE);
    });

    it('should set UPDATE_EACH mode', () => {
      const receiver = new DatabaseReceiver({
        properties: { updateMode: UpdateMode.EACH },
      });

      expect(receiver.getProperties().updateMode).toBe(UpdateMode.EACH);
    });
  });

  describe('connection settings', () => {
    it('should configure connection pooling', () => {
      const receiver = new DatabaseReceiver({
        properties: {
          keepConnectionOpen: true,
          retryCount: 5,
          retryInterval: 5000,
        },
      });

      const props = receiver.getProperties();
      expect(props.keepConnectionOpen).toBe(true);
      expect(props.retryCount).toBe(5);
      expect(props.retryInterval).toBe(5000);
    });

    it('should configure result handling', () => {
      const receiver = new DatabaseReceiver({
        properties: {
          aggregateResults: true,
          cacheResults: false,
          fetchSize: 500,
        },
      });

      const props = receiver.getProperties();
      expect(props.aggregateResults).toBe(true);
      expect(props.cacheResults).toBe(false);
      expect(props.fetchSize).toBe(500);
    });
  });
});
