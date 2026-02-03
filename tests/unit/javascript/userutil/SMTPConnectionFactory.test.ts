import { SMTPConnectionFactory, SMTPConfig } from '../../../../src/javascript/userutil/SMTPConnectionFactory';
import { SMTPConnection } from '../../../../src/javascript/userutil/SMTPConnection';

describe('SMTPConnectionFactory', () => {
  afterEach(() => {
    // Clean up after each test
    SMTPConnectionFactory.clearDefaultConfig();
  });

  describe('setDefaultConfig', () => {
    it('should set the default configuration', () => {
      const config: SMTPConfig = {
        host: 'smtp.example.com',
        port: '587',
        timeout: 30000,
        useAuthentication: true,
        secure: 'TLS',
        username: 'user@example.com',
        password: 'password123',
        from: 'from@example.com',
      };

      SMTPConnectionFactory.setDefaultConfig(config);

      expect(SMTPConnectionFactory.getDefaultConfig()).toEqual(config);
    });

    it('should overwrite previous configuration', () => {
      const config1: SMTPConfig = {
        host: 'smtp1.example.com',
        port: '25',
        useAuthentication: false,
        secure: '',
        username: '',
        password: '',
        from: 'from1@example.com',
      };

      const config2: SMTPConfig = {
        host: 'smtp2.example.com',
        port: '465',
        useAuthentication: true,
        secure: 'SSL',
        username: 'user',
        password: 'pass',
        from: 'from2@example.com',
      };

      SMTPConnectionFactory.setDefaultConfig(config1);
      SMTPConnectionFactory.setDefaultConfig(config2);

      expect(SMTPConnectionFactory.getDefaultConfig()).toEqual(config2);
    });
  });

  describe('getDefaultConfig', () => {
    it('should return null when no config is set', () => {
      expect(SMTPConnectionFactory.getDefaultConfig()).toBeNull();
    });

    it('should return the set configuration', () => {
      const config: SMTPConfig = {
        host: 'smtp.example.com',
        port: '587',
        useAuthentication: true,
        secure: 'TLS',
        username: 'user',
        password: 'pass',
        from: 'from@example.com',
      };

      SMTPConnectionFactory.setDefaultConfig(config);

      expect(SMTPConnectionFactory.getDefaultConfig()).toEqual(config);
    });
  });

  describe('clearDefaultConfig', () => {
    it('should clear the default configuration', () => {
      const config: SMTPConfig = {
        host: 'smtp.example.com',
        port: '587',
        useAuthentication: true,
        secure: 'TLS',
        username: 'user',
        password: 'pass',
        from: 'from@example.com',
      };

      SMTPConnectionFactory.setDefaultConfig(config);
      SMTPConnectionFactory.clearDefaultConfig();

      expect(SMTPConnectionFactory.getDefaultConfig()).toBeNull();
    });
  });

  describe('createSMTPConnection', () => {
    it('should throw error when no config is set', () => {
      expect(() => SMTPConnectionFactory.createSMTPConnection()).toThrow(
        'SMTP configuration not set'
      );
    });

    it('should create SMTPConnection with default config', () => {
      const config: SMTPConfig = {
        host: 'smtp.example.com',
        port: '587',
        timeout: 30000,
        useAuthentication: true,
        secure: 'TLS',
        username: 'user@example.com',
        password: 'password123',
        from: 'from@example.com',
      };

      SMTPConnectionFactory.setDefaultConfig(config);

      const connection = SMTPConnectionFactory.createSMTPConnection();

      expect(connection).toBeInstanceOf(SMTPConnection);
      expect(connection.getHost()).toBe('smtp.example.com');
      expect(connection.getPort()).toBe('587');
      expect(connection.getSocketTimeout()).toBe(30000);
      expect(connection.isUseAuthentication()).toBe(true);
      expect(connection.getSecure()).toBe('TLS');
      expect(connection.getUsername()).toBe('user@example.com');
      expect(connection.getPassword()).toBe('password123');
      expect(connection.getFrom()).toBe('from@example.com');
    });

    it('should use default timeout when not specified', () => {
      const config: SMTPConfig = {
        host: 'smtp.example.com',
        port: '25',
        useAuthentication: false,
        secure: '',
        username: '',
        password: '',
        from: 'from@example.com',
      };

      SMTPConnectionFactory.setDefaultConfig(config);

      const connection = SMTPConnectionFactory.createSMTPConnection();

      expect(connection.getSocketTimeout()).toBe(60000);
    });

    it('should create multiple independent connections', () => {
      const config: SMTPConfig = {
        host: 'smtp.example.com',
        port: '587',
        useAuthentication: true,
        secure: 'TLS',
        username: 'user',
        password: 'pass',
        from: 'from@example.com',
      };

      SMTPConnectionFactory.setDefaultConfig(config);

      const conn1 = SMTPConnectionFactory.createSMTPConnection();
      const conn2 = SMTPConnectionFactory.createSMTPConnection();

      // Modify conn1
      conn1.setHost('modified.example.com');

      // conn2 should be unaffected
      expect(conn2.getHost()).toBe('smtp.example.com');
    });

    it('should work with SSL configuration', () => {
      const config: SMTPConfig = {
        host: 'smtp.example.com',
        port: '465',
        timeout: 45000,
        useAuthentication: true,
        secure: 'SSL',
        username: 'user',
        password: 'pass',
        from: 'from@example.com',
      };

      SMTPConnectionFactory.setDefaultConfig(config);

      const connection = SMTPConnectionFactory.createSMTPConnection();

      expect(connection.getPort()).toBe('465');
      expect(connection.getSecure()).toBe('SSL');
    });

    it('should work with no encryption configuration', () => {
      const config: SMTPConfig = {
        host: 'localhost',
        port: '25',
        useAuthentication: false,
        secure: '',
        username: '',
        password: '',
        from: 'test@localhost',
      };

      SMTPConnectionFactory.setDefaultConfig(config);

      const connection = SMTPConnectionFactory.createSMTPConnection();

      expect(connection.getSecure()).toBe('');
      expect(connection.isUseAuthentication()).toBe(false);
    });
  });
});
