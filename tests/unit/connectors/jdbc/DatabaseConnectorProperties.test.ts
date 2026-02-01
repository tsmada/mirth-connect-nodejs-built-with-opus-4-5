import {
  getDefaultDatabaseReceiverProperties,
  getDefaultDatabaseDispatcherProperties,
  parseJdbcUrl,
  rowToXml,
  resultsToXml,
  UpdateMode,
} from '../../../../src/connectors/jdbc/DatabaseConnectorProperties';

describe('DatabaseConnectorProperties', () => {
  describe('getDefaultDatabaseReceiverProperties', () => {
    it('should return default receiver properties', () => {
      const props = getDefaultDatabaseReceiverProperties();

      expect(props.driver).toBe('');
      expect(props.url).toBe('');
      expect(props.username).toBe('');
      expect(props.password).toBe('');
      expect(props.select).toBe('');
      expect(props.update).toBe('');
      expect(props.useScript).toBe(false);
      expect(props.aggregateResults).toBe(false);
      expect(props.cacheResults).toBe(true);
      expect(props.keepConnectionOpen).toBe(true);
      expect(props.updateMode).toBe(UpdateMode.NEVER);
      expect(props.retryCount).toBe(3);
      expect(props.retryInterval).toBe(10000);
      expect(props.fetchSize).toBe(1000);
      expect(props.encoding).toBe('UTF-8');
      expect(props.pollInterval).toBe(5000);
    });

    it('should return independent instances', () => {
      const props1 = getDefaultDatabaseReceiverProperties();
      const props2 = getDefaultDatabaseReceiverProperties();

      props1.url = 'jdbc:mysql://localhost/test';
      expect(props2.url).toBe('');
    });
  });

  describe('getDefaultDatabaseDispatcherProperties', () => {
    it('should return default dispatcher properties', () => {
      const props = getDefaultDatabaseDispatcherProperties();

      expect(props.driver).toBe('');
      expect(props.url).toBe('');
      expect(props.username).toBe('');
      expect(props.password).toBe('');
      expect(props.query).toBe('');
      expect(props.useScript).toBe(false);
      expect(props.parameters).toEqual([]);
    });

    it('should return independent instances', () => {
      const props1 = getDefaultDatabaseDispatcherProperties();
      const props2 = getDefaultDatabaseDispatcherProperties();

      props1.query = 'SELECT * FROM test';
      expect(props2.query).toBe('');
    });
  });

  describe('parseJdbcUrl', () => {
    it('should parse MySQL JDBC URL with port', () => {
      const config = parseJdbcUrl('jdbc:mysql://localhost:3306/testdb');

      expect(config).not.toBeNull();
      expect(config?.host).toBe('localhost');
      expect(config?.port).toBe(3306);
      expect(config?.database).toBe('testdb');
    });

    it('should parse MySQL JDBC URL without port', () => {
      const config = parseJdbcUrl('jdbc:mysql://localhost/testdb');

      expect(config).not.toBeNull();
      expect(config?.host).toBe('localhost');
      expect(config?.port).toBe(3306); // Default MySQL port
      expect(config?.database).toBe('testdb');
    });

    it('should parse MySQL JDBC URL with query params', () => {
      const config = parseJdbcUrl(
        'jdbc:mysql://myhost:3307/mydb?useSSL=true&serverTimezone=UTC'
      );

      expect(config).not.toBeNull();
      expect(config?.host).toBe('myhost');
      expect(config?.port).toBe(3307);
      expect(config?.database).toBe('mydb');
    });

    it('should return null for invalid URL', () => {
      expect(parseJdbcUrl('invalid-url')).toBeNull();
      expect(parseJdbcUrl('jdbc:postgresql://localhost/test')).toBeNull();
      expect(parseJdbcUrl('')).toBeNull();
    });
  });

  describe('rowToXml', () => {
    it('should convert row to XML', () => {
      const row = {
        id: 1,
        name: 'Test',
        value: 42,
      };

      const xml = rowToXml(row, 0);

      expect(xml).toContain('<result>');
      expect(xml).toContain('<id>1</id>');
      expect(xml).toContain('<name>Test</name>');
      expect(xml).toContain('<value>42</value>');
      expect(xml).toContain('</result>');
    });

    it('should escape XML special characters', () => {
      const row = {
        text: '<script>alert("xss")</script>',
        ampersand: 'A & B',
      };

      const xml = rowToXml(row, 0);

      expect(xml).toContain('&lt;script&gt;');
      expect(xml).toContain('&quot;xss&quot;');
      expect(xml).toContain('A &amp; B');
    });

    it('should handle null values', () => {
      const row = {
        id: 1,
        name: null,
      };

      const xml = rowToXml(row, 0);

      expect(xml).toContain('<name></name>');
    });
  });

  describe('resultsToXml', () => {
    it('should convert results to XML', () => {
      const rows = [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
      ];

      const xml = resultsToXml(rows);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<results>');
      expect(xml).toContain('<result>');
      expect(xml).toContain('<id>1</id>');
      expect(xml).toContain('<name>First</name>');
      expect(xml).toContain('<id>2</id>');
      expect(xml).toContain('<name>Second</name>');
      expect(xml).toContain('</results>');
    });

    it('should handle empty results', () => {
      const xml = resultsToXml([]);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<results>');
      expect(xml).toContain('</results>');
    });
  });

  describe('UpdateMode enum', () => {
    it('should have correct values', () => {
      expect(UpdateMode.NEVER).toBe(1);
      expect(UpdateMode.ONCE).toBe(2);
      expect(UpdateMode.EACH).toBe(3);
    });
  });
});
