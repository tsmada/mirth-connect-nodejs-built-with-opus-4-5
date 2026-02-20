/**
 * ExtensionServlet Unit Tests
 *
 * Tests for extension/plugin management endpoints including:
 * - GET / - Get all extensions
 * - GET /connectors - Get connector metadata
 * - GET /plugins - Get plugin metadata
 * - GET /:extensionName - Get extension by name
 * - GET /:extensionName/enabled - Check if extension is enabled
 * - PUT /:extensionName/enabled/:enabled - Enable/disable extension
 * - POST /:extensionName/_setEnabled - Enable/disable (POST variant)
 * - GET /:extensionName/properties - Get extension properties
 * - PUT /:extensionName/properties - Set extension properties
 * - POST /_install - Install extension (501 stub)
 * - POST /_uninstall - Uninstall extension (501 stub)
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock the database pool BEFORE importing the servlet
const mockQuery = jest.fn();
const mockExecute = jest.fn();

jest.mock('../../../../src/db/pool.js', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

// Mock authorization - passthrough to route handlers
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// Mock operations used by ExtensionServlet
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  EXTENSION_GET: { name: 'getExtension' },
  EXTENSION_GET_ALL: { name: 'getAllExtensions' },
  EXTENSION_SET_ENABLED: { name: 'setExtensionEnabled' },
  EXTENSION_GET_PROPERTIES: { name: 'getExtensionProperties' },
  EXTENSION_SET_PROPERTIES: { name: 'setExtensionProperties' },
}));

// Mock logging
jest.mock('../../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  registerComponent: jest.fn(),
}));

// Now import Express and the servlet AFTER all mocks are in place
import express, { Express } from 'express';
import { extensionRouter } from '../../../../src/api/servlets/ExtensionServlet.js';

// ============================================================================
// Test app factory
// ============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Add sendData helper matching the real app
  app.use((_req, res, next) => {
    res.sendData = function (data: unknown, status?: number) {
      if (status) this.status(status);
      this.json(data);
    };
    next();
  });

  app.use('/extensions', extensionRouter);
  return app;
}

// ============================================================================
// Constants
// ============================================================================

// Built-in extension names (must match the servlet source)
const BUILT_IN_PLUGINS = ['Data Pruner', 'Message Generator', 'Server Log'];
const BUILT_IN_SOURCE_CONNECTORS = [
  'HTTP Listener',
  'TCP Listener',
  'File Reader',
  'Database Reader',
];
const BUILT_IN_DEST_CONNECTORS = [
  'HTTP Sender',
  'TCP Sender',
  'File Writer',
  'Database Writer',
  'JavaScript Writer',
];
const ALL_BUILT_IN_NAMES = [
  ...BUILT_IN_PLUGINS,
  ...BUILT_IN_SOURCE_CONNECTORS,
  ...BUILT_IN_DEST_CONNECTORS,
];

// ============================================================================
// Helpers
// ============================================================================

/** Build a mock EXTENSION DB row */
function makeExtensionRow(overrides: Record<string, unknown> = {}) {
  return {
    NAME: 'Data Pruner',
    CATEGORY: 'plugin',
    ENABLED: 1,
    PROPERTIES: null,
    constructor: { name: 'RowDataPacket' },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ExtensionServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: ensureExtensionTable succeeds, no DB overrides
    mockExecute.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue([]);
  });

  // ==========================================================================
  // GET /extensions - Get all extensions
  // ==========================================================================

  describe('GET /extensions', () => {
    it('should return all built-in extensions when no DB overrides', async () => {
      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(ALL_BUILT_IN_NAMES.length);

      const names = response.body.map((ext: any) => ext.name);
      for (const name of ALL_BUILT_IN_NAMES) {
        expect(names).toContain(name);
      }
    });

    it('should merge database overrides into built-in extensions', async () => {
      mockQuery.mockResolvedValueOnce([
        makeExtensionRow({ NAME: 'Data Pruner', ENABLED: 0, PROPERTIES: '{"key":"value"}' }),
      ]);

      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);
      const pruner = response.body.find((ext: any) => ext.name === 'Data Pruner');
      expect(pruner).toBeDefined();
      expect(pruner.enabled).toBe(false);
      expect(pruner.properties).toEqual({ key: 'value' });
    });

    it('should call ensureExtensionTable before querying', async () => {
      await request(app).get('/extensions');

      // ensureExtensionTable calls execute with CREATE TABLE IF NOT EXISTS
      expect(mockExecute).toHaveBeenCalled();
      const createCall = mockExecute.mock.calls[0]?.[0] as string;
      expect(createCall).toContain('CREATE TABLE IF NOT EXISTS EXTENSION');
    });

    it('should return all extensions with correct fields', async () => {
      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);
      for (const ext of response.body) {
        expect(ext).toHaveProperty('name');
        expect(ext).toHaveProperty('author');
        expect(ext).toHaveProperty('pluginVersion');
        expect(ext).toHaveProperty('mirthVersion');
        expect(ext).toHaveProperty('enabled');
        expect(ext).toHaveProperty('properties');
      }
    });

    it('should handle DB override with null PROPERTIES gracefully', async () => {
      mockQuery.mockResolvedValueOnce([
        makeExtensionRow({ NAME: 'Server Log', ENABLED: 1, PROPERTIES: null }),
      ]);

      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);
      const serverLog = response.body.find((ext: any) => ext.name === 'Server Log');
      expect(serverLog.properties).toEqual({});
    });

    it('should return 500 when database query fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB connection lost'));

      const response = await request(app).get('/extensions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get extensions');
    });

    it('should return 500 when SELECT query fails', async () => {
      // ensureExtensionTable succeeds
      mockExecute.mockResolvedValueOnce(undefined);
      // SELECT query fails
      mockQuery.mockRejectedValueOnce(new Error('Table locked'));

      const response = await request(app).get('/extensions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get extensions');
    });
  });

  // ==========================================================================
  // GET /extensions/connectors - Get connector metadata
  // ==========================================================================

  describe('GET /extensions/connectors', () => {
    it('should return only connector extensions (those with type and transportName)', async () => {
      const response = await request(app).get('/extensions/connectors');

      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);

      // Should include all source + destination connectors
      const expected = [...BUILT_IN_SOURCE_CONNECTORS, ...BUILT_IN_DEST_CONNECTORS];
      expect(response.body.length).toBe(expected.length);

      for (const connector of response.body) {
        expect(connector).toHaveProperty('type');
        expect(connector).toHaveProperty('transportName');
        expect(connector).toHaveProperty('protocol');
        expect(['source', 'destination', 'both']).toContain(connector.type);
      }
    });

    it('should not include plugin-only extensions', async () => {
      const response = await request(app).get('/extensions/connectors');

      expect(response.status).toBe(200);
      const names = response.body.map((ext: any) => ext.name);
      for (const pluginName of BUILT_IN_PLUGINS) {
        expect(names).not.toContain(pluginName);
      }
    });

    it('should include source connectors with type=source', async () => {
      const response = await request(app).get('/extensions/connectors');

      expect(response.status).toBe(200);
      const sourceConnectors = response.body.filter((c: any) => c.type === 'source');
      expect(sourceConnectors.length).toBe(BUILT_IN_SOURCE_CONNECTORS.length);
    });

    it('should include destination connectors with type=destination', async () => {
      const response = await request(app).get('/extensions/connectors');

      expect(response.status).toBe(200);
      const destConnectors = response.body.filter((c: any) => c.type === 'destination');
      expect(destConnectors.length).toBe(BUILT_IN_DEST_CONNECTORS.length);
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/extensions/connectors');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get connectors');
    });
  });

  // ==========================================================================
  // GET /extensions/plugins - Get plugin metadata
  // ==========================================================================

  describe('GET /extensions/plugins', () => {
    it('should return only non-connector extensions', async () => {
      const response = await request(app).get('/extensions/plugins');

      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(BUILT_IN_PLUGINS.length);

      const names = response.body.map((ext: any) => ext.name);
      for (const pluginName of BUILT_IN_PLUGINS) {
        expect(names).toContain(pluginName);
      }
    });

    it('should not include connector extensions', async () => {
      const response = await request(app).get('/extensions/plugins');

      expect(response.status).toBe(200);
      for (const plugin of response.body) {
        expect(plugin).not.toHaveProperty('type');
        expect(plugin).not.toHaveProperty('transportName');
      }
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/extensions/plugins');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get plugins');
    });
  });

  // ==========================================================================
  // POST /extensions/_install - Install (501 stub)
  // ==========================================================================

  describe('POST /extensions/_install', () => {
    it('should return 501 not supported', async () => {
      const response = await request(app)
        .post('/extensions/_install')
        .send({});

      expect(response.status).toBe(501);
      expect(response.body.error).toBe(
        'Extension installation is not supported in Node.js Mirth'
      );
    });
  });

  // ==========================================================================
  // POST /extensions/_uninstall - Uninstall (501 stub)
  // ==========================================================================

  describe('POST /extensions/_uninstall', () => {
    it('should return 501 not supported', async () => {
      const response = await request(app)
        .post('/extensions/_uninstall')
        .send({});

      expect(response.status).toBe(501);
      expect(response.body.error).toBe(
        'Extension uninstallation is not supported in Node.js Mirth'
      );
    });
  });

  // ==========================================================================
  // GET /extensions/:extensionName - Get extension by name
  // ==========================================================================

  describe('GET /extensions/:extensionName', () => {
    it('should return a built-in extension by name', async () => {
      const response = await request(app).get('/extensions/Data%20Pruner');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Data Pruner');
      expect(response.body.author).toBe('Mirth Corporation');
      expect(response.body.enabled).toBe(true);
    });

    it('should return a connector extension by name', async () => {
      const response = await request(app).get('/extensions/HTTP%20Listener');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('HTTP Listener');
      expect(response.body.type).toBe('source');
      expect(response.body.transportName).toBe('HTTP Listener');
      expect(response.body.protocol).toBe('HTTP');
    });

    it('should merge DB overrides for a specific extension', async () => {
      mockQuery.mockResolvedValueOnce([
        makeExtensionRow({
          NAME: 'Data Pruner',
          ENABLED: 0,
          PROPERTIES: '{"schedule":"daily"}',
        }),
      ]);

      const response = await request(app).get('/extensions/Data%20Pruner');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Data Pruner');
      expect(response.body.enabled).toBe(false);
      expect(response.body.properties).toEqual({ schedule: 'daily' });
    });

    it('should return 404 for unknown extension', async () => {
      const response = await request(app).get('/extensions/NonExistent%20Plugin');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Extension not found');
    });

    it('should decode URL-encoded extension names', async () => {
      const response = await request(app).get('/extensions/JavaScript%20Writer');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('JavaScript Writer');
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/extensions/Data%20Pruner');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get extension');
    });
  });

  // ==========================================================================
  // GET /extensions/:extensionName/enabled - Check if enabled
  // ==========================================================================

  describe('GET /extensions/:extensionName/enabled', () => {
    it('should return true for an enabled built-in extension', async () => {
      const response = await request(app).get('/extensions/Data%20Pruner/enabled');

      expect(response.status).toBe(200);
      expect(response.body).toBe(true);
    });

    it('should return false for a disabled extension (DB override)', async () => {
      mockQuery.mockResolvedValueOnce([
        makeExtensionRow({ NAME: 'Data Pruner', ENABLED: 0 }),
      ]);

      const response = await request(app).get('/extensions/Data%20Pruner/enabled');

      expect(response.status).toBe(200);
      expect(response.body).toBe(false);
    });

    it('should return 404 for unknown extension', async () => {
      const response = await request(app).get('/extensions/UnknownPlugin/enabled');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Extension not found');
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/extensions/Data%20Pruner/enabled');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to check extension enabled');
    });
  });

  // ==========================================================================
  // PUT /extensions/:extensionName/enabled/:enabled - Enable/disable
  // ==========================================================================

  describe('PUT /extensions/:extensionName/enabled/:enabled', () => {
    it('should enable an extension and return 204', async () => {
      const response = await request(app)
        .put('/extensions/Data%20Pruner/enabled/true');

      expect(response.status).toBe(204);
      expect(mockExecute).toHaveBeenCalledTimes(2); // ensureExtensionTable + INSERT/UPDATE
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[0]).toContain('INSERT INTO EXTENSION');
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 1 });
    });

    it('should disable an extension and return 204', async () => {
      const response = await request(app)
        .put('/extensions/Data%20Pruner/enabled/false');

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 0 });
    });

    it('should return 404 for unknown extension', async () => {
      const response = await request(app)
        .put('/extensions/NonExistent/enabled/true');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Extension not found');
    });

    it('should decode URL-encoded extension names', async () => {
      const response = await request(app)
        .put('/extensions/HTTP%20Listener/enabled/false');

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'HTTP Listener', enabled: 0 });
    });

    it('should treat any value other than "true" as false', async () => {
      const response = await request(app)
        .put('/extensions/Data%20Pruner/enabled/yes');

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 0 });
    });

    it('should return 500 on database error', async () => {
      // ensureExtensionTable succeeds
      mockExecute.mockResolvedValueOnce(undefined);
      // INSERT fails
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .put('/extensions/Data%20Pruner/enabled/true');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to set extension enabled');
    });
  });

  // ==========================================================================
  // POST /extensions/:extensionName/_setEnabled - Enable/disable (POST variant)
  // ==========================================================================

  describe('POST /extensions/:extensionName/_setEnabled', () => {
    it('should enable extension via body enabled=true (string)', async () => {
      const response = await request(app)
        .post('/extensions/Data%20Pruner/_setEnabled')
        .send({ enabled: 'true' });

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 1 });
    });

    it('should enable extension via body enabled=true (boolean)', async () => {
      const response = await request(app)
        .post('/extensions/Data%20Pruner/_setEnabled')
        .send({ enabled: true });

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 1 });
    });

    it('should enable extension via query parameter enabled=true', async () => {
      const response = await request(app)
        .post('/extensions/Data%20Pruner/_setEnabled?enabled=true')
        .send({});

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 1 });
    });

    it('should disable extension when body enabled=false', async () => {
      const response = await request(app)
        .post('/extensions/Data%20Pruner/_setEnabled')
        .send({ enabled: 'false' });

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 0 });
    });

    it('should disable extension when no enabled field provided', async () => {
      const response = await request(app)
        .post('/extensions/Data%20Pruner/_setEnabled')
        .send({});

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 0 });
    });

    it('should return 404 for unknown extension', async () => {
      const response = await request(app)
        .post('/extensions/NonExistent/_setEnabled')
        .send({ enabled: true });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Extension not found');
    });

    it('should decode URL-encoded extension names', async () => {
      const response = await request(app)
        .post('/extensions/TCP%20Sender/_setEnabled')
        .send({ enabled: true });

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'TCP Sender', enabled: 1 });
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockResolvedValueOnce(undefined);
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/extensions/Data%20Pruner/_setEnabled')
        .send({ enabled: true });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to set extension enabled');
    });
  });

  // ==========================================================================
  // GET /extensions/:extensionName/properties - Get properties
  // ==========================================================================

  describe('GET /extensions/:extensionName/properties', () => {
    it('should return empty properties for a built-in extension with no DB override', async () => {
      const response = await request(app).get('/extensions/Data%20Pruner/properties');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({});
    });

    it('should return properties from DB override', async () => {
      mockQuery.mockResolvedValueOnce([
        makeExtensionRow({
          NAME: 'Data Pruner',
          ENABLED: 1,
          PROPERTIES: '{"schedule":"0 3 * * *","retentionDays":"30"}',
        }),
      ]);

      const response = await request(app).get('/extensions/Data%20Pruner/properties');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ schedule: '0 3 * * *', retentionDays: '30' });
    });

    it('should return 404 for unknown extension', async () => {
      const response = await request(app).get('/extensions/Unknown/properties');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Extension not found');
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/extensions/Data%20Pruner/properties');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get extension properties');
    });
  });

  // ==========================================================================
  // PUT /extensions/:extensionName/properties - Set properties
  // ==========================================================================

  describe('PUT /extensions/:extensionName/properties', () => {
    it('should set properties and return 204', async () => {
      const props = { schedule: '0 4 * * *', retentionDays: '60' };

      const response = await request(app)
        .put('/extensions/Data%20Pruner/properties')
        .send(props);

      expect(response.status).toBe(204);
      expect(mockExecute).toHaveBeenCalledTimes(2); // ensureExtensionTable + INSERT/UPDATE
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[0]).toContain('INSERT INTO EXTENSION');
      expect(upsertCall?.[0]).toContain('ON DUPLICATE KEY UPDATE PROPERTIES');
      expect(upsertCall?.[1]).toEqual({
        name: 'Data Pruner',
        properties: JSON.stringify(props),
      });
    });

    it('should set empty properties', async () => {
      const response = await request(app)
        .put('/extensions/Data%20Pruner/properties')
        .send({});

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({
        name: 'Data Pruner',
        properties: '{}',
      });
    });

    it('should return 404 for unknown extension', async () => {
      const response = await request(app)
        .put('/extensions/NonExistent/properties')
        .send({ key: 'value' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Extension not found');
    });

    it('should decode URL-encoded extension names', async () => {
      const response = await request(app)
        .put('/extensions/File%20Reader/properties')
        .send({ pollInterval: '5000' });

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({
        name: 'File Reader',
        properties: JSON.stringify({ pollInterval: '5000' }),
      });
    });

    it('should return 500 on database error', async () => {
      mockExecute.mockResolvedValueOnce(undefined);
      mockExecute.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .put('/extensions/Data%20Pruner/properties')
        .send({ key: 'value' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to set extension properties');
    });
  });

  // ==========================================================================
  // Built-in extension data integrity
  // ==========================================================================

  describe('Built-in extension data integrity', () => {
    it('should include all expected plugin names', async () => {
      const response = await request(app).get('/extensions/plugins');

      expect(response.status).toBe(200);
      const names = response.body.map((ext: any) => ext.name);
      expect(names).toContain('Data Pruner');
      expect(names).toContain('Message Generator');
      expect(names).toContain('Server Log');
    });

    it('should include all expected source connectors', async () => {
      const response = await request(app).get('/extensions/connectors');

      expect(response.status).toBe(200);
      const sourceNames = response.body
        .filter((c: any) => c.type === 'source')
        .map((c: any) => c.name);

      expect(sourceNames).toContain('HTTP Listener');
      expect(sourceNames).toContain('TCP Listener');
      expect(sourceNames).toContain('File Reader');
      expect(sourceNames).toContain('Database Reader');
    });

    it('should include all expected destination connectors', async () => {
      const response = await request(app).get('/extensions/connectors');

      expect(response.status).toBe(200);
      const destNames = response.body
        .filter((c: any) => c.type === 'destination')
        .map((c: any) => c.name);

      expect(destNames).toContain('HTTP Sender');
      expect(destNames).toContain('TCP Sender');
      expect(destNames).toContain('File Writer');
      expect(destNames).toContain('Database Writer');
      expect(destNames).toContain('JavaScript Writer');
    });

    it('should have author=Mirth Corporation for all built-in extensions', async () => {
      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);
      for (const ext of response.body) {
        expect(ext.author).toBe('Mirth Corporation');
      }
    });

    it('should have pluginVersion and mirthVersion set for all extensions', async () => {
      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);
      for (const ext of response.body) {
        expect(ext.pluginVersion).toBe('3.9.0');
        expect(ext.mirthVersion).toBe('3.9.0');
      }
    });

    it('should have all built-in extensions enabled by default', async () => {
      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);
      for (const ext of response.body) {
        expect(ext.enabled).toBe(true);
      }
    });

    it('connectors should have protocol field matching transport type', async () => {
      const response = await request(app).get('/extensions/connectors');

      expect(response.status).toBe(200);
      const httpListener = response.body.find((c: any) => c.name === 'HTTP Listener');
      expect(httpListener.protocol).toBe('HTTP');

      const tcpSender = response.body.find((c: any) => c.name === 'TCP Sender');
      expect(tcpSender.protocol).toBe('TCP');

      const fileWriter = response.body.find((c: any) => c.name === 'File Writer');
      expect(fileWriter.protocol).toBe('File');

      const dbReader = response.body.find((c: any) => c.name === 'Database Reader');
      expect(dbReader.protocol).toBe('Database');

      const jsWriter = response.body.find((c: any) => c.name === 'JavaScript Writer');
      expect(jsWriter.protocol).toBe('JavaScript');
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('Edge cases', () => {
    it('should handle multiple DB overrides in GET /extensions', async () => {
      mockQuery.mockResolvedValueOnce([
        makeExtensionRow({ NAME: 'Data Pruner', ENABLED: 0, PROPERTIES: '{"a":"1"}' }),
        makeExtensionRow({ NAME: 'Server Log', ENABLED: 1, PROPERTIES: '{"b":"2"}' }),
        makeExtensionRow({ NAME: 'HTTP Listener', ENABLED: 0, PROPERTIES: null }),
      ]);

      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);

      const pruner = response.body.find((ext: any) => ext.name === 'Data Pruner');
      expect(pruner.enabled).toBe(false);
      expect(pruner.properties).toEqual({ a: '1' });

      const serverLog = response.body.find((ext: any) => ext.name === 'Server Log');
      expect(serverLog.enabled).toBe(true);
      expect(serverLog.properties).toEqual({ b: '2' });

      const httpListener = response.body.find((ext: any) => ext.name === 'HTTP Listener');
      expect(httpListener.enabled).toBe(false);
      expect(httpListener.properties).toEqual({});
    });

    it('should ignore DB rows for extensions not in built-in list', async () => {
      mockQuery.mockResolvedValueOnce([
        makeExtensionRow({ NAME: 'Custom Plugin', ENABLED: 1, PROPERTIES: '{"x":"y"}' }),
      ]);

      const response = await request(app).get('/extensions');

      expect(response.status).toBe(200);
      const custom = response.body.find((ext: any) => ext.name === 'Custom Plugin');
      expect(custom).toBeUndefined();
    });

    it('GET /:extensionName should return built-in when no DB row exists', async () => {
      // DB returns empty for the query
      mockQuery.mockResolvedValueOnce([]);

      const response = await request(app).get('/extensions/Message%20Generator');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Message Generator');
      expect(response.body.enabled).toBe(true);
      expect(response.body.properties).toEqual({});
    });

    it('PUT enabled should use ON DUPLICATE KEY UPDATE for idempotent upsert', async () => {
      await request(app).put('/extensions/Data%20Pruner/enabled/true');

      const upsertCall = mockExecute.mock.calls[1]?.[0] as string;
      expect(upsertCall).toContain('ON DUPLICATE KEY UPDATE ENABLED');
    });

    it('PUT properties should use ON DUPLICATE KEY UPDATE for idempotent upsert', async () => {
      await request(app)
        .put('/extensions/Data%20Pruner/properties')
        .send({ key: 'val' });

      const upsertCall = mockExecute.mock.calls[1]?.[0] as string;
      expect(upsertCall).toContain('ON DUPLICATE KEY UPDATE PROPERTIES');
    });

    it('POST _setEnabled should prefer body over query param', async () => {
      // body says true, query says nothing - body wins
      const response = await request(app)
        .post('/extensions/Data%20Pruner/_setEnabled')
        .send({ enabled: 'true' });

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 1 });
    });

    it('POST _setEnabled with query enabled=true should work even with empty body', async () => {
      const response = await request(app)
        .post('/extensions/Data%20Pruner/_setEnabled?enabled=true')
        .send({});

      expect(response.status).toBe(204);
      const upsertCall = mockExecute.mock.calls[1];
      expect(upsertCall?.[1]).toEqual({ name: 'Data Pruner', enabled: 1 });
    });
  });
});
