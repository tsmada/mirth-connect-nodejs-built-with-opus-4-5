/**
 * ConfigurationServlet Unit Tests
 *
 * Tests for server configuration endpoints including:
 * - Simple info endpoints (id, version, buildDate, status, timezone, time, jvm, about)
 * - Charset and GUID generation
 * - License info, protocols, Rhino language version
 * - GET/PUT pairs: settings, globalScripts, configurationMap, databaseDrivers,
 *   channelTags, channelDependencies, channelMetadata, resources, updateSettings, encryption
 * - GET /configuration — full backup (aggregates 8 controllers in parallel)
 * - PUT /configuration — restore (iterates channels, creates/updates)
 * - POST /_testEmail — validates params, sends email, handles failures
 * - POST /resources/:resourceId/_reload
 * - GET /server/passwordRequirements passthrough
 */

import { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock: authorization (passthrough)
// ---------------------------------------------------------------------------
jest.mock('../../../../src/api/middleware/authorization.js', () => ({
  authorize: jest.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  createOperation: jest.fn((name: string) => ({ name, displayName: name, permission: 'TEST' })),
}));

// ---------------------------------------------------------------------------
// Mock: operations — ALL CONFIG_* constants used by ConfigurationServlet
// ---------------------------------------------------------------------------
jest.mock('../../../../src/api/middleware/operations.js', () => ({
  CONFIG_GET_SERVER_ID:             { name: 'getServerId' },
  CONFIG_GET_VERSION:               { name: 'getVersion' },
  CONFIG_GET_BUILD_DATE:            { name: 'getBuildDate' },
  CONFIG_GET_STATUS:                { name: 'getStatus' },
  CONFIG_GET_TIMEZONE:              { name: 'getTimezone' },
  CONFIG_GET_TIME:                  { name: 'getTime' },
  CONFIG_GET_JVM:                   { name: 'getJvm' },
  CONFIG_GET_ABOUT:                 { name: 'getAbout' },
  CONFIG_GET_SETTINGS:              { name: 'getSettings' },
  CONFIG_SET_SETTINGS:              { name: 'setSettings' },
  CONFIG_GET_ENCRYPTION:            { name: 'getEncryption' },
  CONFIG_GET_CHARSETS:              { name: 'getCharsets' },
  CONFIG_GENERATE_GUID:             { name: 'generateGuid' },
  CONFIG_GET_GLOBAL_SCRIPTS:        { name: 'getGlobalScripts' },
  CONFIG_SET_GLOBAL_SCRIPTS:        { name: 'setGlobalScripts' },
  CONFIG_GET_CONFIG_MAP:            { name: 'getConfigMap' },
  CONFIG_SET_CONFIG_MAP:            { name: 'setConfigMap' },
  CONFIG_GET_DB_DRIVERS:            { name: 'getDbDrivers' },
  CONFIG_SET_DB_DRIVERS:            { name: 'setDbDrivers' },
  CONFIG_GET_PASSWORD_REQUIREMENTS: { name: 'getPasswordRequirements' },
  CONFIG_GET_UPDATE_SETTINGS:       { name: 'getUpdateSettings' },
  CONFIG_SET_UPDATE_SETTINGS:       { name: 'setUpdateSettings' },
  CONFIG_GET_LICENSE:               { name: 'getLicense' },
  CONFIG_GET_RESOURCES:             { name: 'getResources' },
  CONFIG_SET_RESOURCES:             { name: 'setResources' },
  CONFIG_RELOAD_RESOURCE:           { name: 'reloadResource' },
  CONFIG_GET_CHANNEL_DEPS:          { name: 'getChannelDeps' },
  CONFIG_SET_CHANNEL_DEPS:          { name: 'setChannelDeps' },
  CONFIG_GET_CHANNEL_TAGS:          { name: 'getChannelTags' },
  CONFIG_SET_CHANNEL_TAGS:          { name: 'setChannelTags' },
  CONFIG_GET_CHANNEL_METADATA:      { name: 'getChannelMetadata' },
  CONFIG_SET_CHANNEL_METADATA:      { name: 'setChannelMetadata' },
  CONFIG_GET_PROTOCOLS:             { name: 'getProtocols' },
  CONFIG_GET_RHINO_VERSION:         { name: 'getRhinoVersion' },
  CONFIG_GET_SERVER_CONFIGURATION:  { name: 'getServerConfiguration' },
  CONFIG_SET_SERVER_CONFIGURATION:  { name: 'setServerConfiguration' },
  CONFIG_TEST_EMAIL:                { name: 'testEmail' },
}));

// ---------------------------------------------------------------------------
// Mock: ConfigurationController — all methods return mock data
// ---------------------------------------------------------------------------
const mockGetServerId             = jest.fn();
const mockGetServerSettings       = jest.fn();
const mockSetServerSettings       = jest.fn();
const mockGetEncryptionSettings   = jest.fn();
const mockGetGlobalScripts        = jest.fn();
const mockSetGlobalScripts        = jest.fn();
const mockGetConfigurationMap     = jest.fn();
const mockSetConfigurationMap     = jest.fn();
const mockGetDatabaseDrivers      = jest.fn();
const mockSetDatabaseDrivers      = jest.fn();
const mockGetPasswordRequirements = jest.fn();
const mockGetUpdateSettings       = jest.fn();
const mockSetUpdateSettings       = jest.fn();
const mockGetResources            = jest.fn();
const mockSetResources            = jest.fn();
const mockReloadResource          = jest.fn();
const mockGetChannelDependencies  = jest.fn();
const mockSetChannelDependencies  = jest.fn();
const mockGetChannelTags          = jest.fn();
const mockSetChannelTags          = jest.fn();
const mockGetChannelMetadata      = jest.fn();
const mockSetChannelMetadata      = jest.fn();

jest.mock('../../../../src/controllers/ConfigurationController.js', () => ({
  ConfigurationController: {
    getServerId:             (...a: any[]) => mockGetServerId(...a),
    getServerSettings:       (...a: any[]) => mockGetServerSettings(...a),
    setServerSettings:       (...a: any[]) => mockSetServerSettings(...a),
    getEncryptionSettings:   (...a: any[]) => mockGetEncryptionSettings(...a),
    getGlobalScripts:        (...a: any[]) => mockGetGlobalScripts(...a),
    setGlobalScripts:        (...a: any[]) => mockSetGlobalScripts(...a),
    getConfigurationMap:     (...a: any[]) => mockGetConfigurationMap(...a),
    setConfigurationMap:     (...a: any[]) => mockSetConfigurationMap(...a),
    getDatabaseDrivers:      (...a: any[]) => mockGetDatabaseDrivers(...a),
    setDatabaseDrivers:      (...a: any[]) => mockSetDatabaseDrivers(...a),
    getPasswordRequirements: (...a: any[]) => mockGetPasswordRequirements(...a),
    getUpdateSettings:       (...a: any[]) => mockGetUpdateSettings(...a),
    setUpdateSettings:       (...a: any[]) => mockSetUpdateSettings(...a),
    getResources:            (...a: any[]) => mockGetResources(...a),
    setResources:            (...a: any[]) => mockSetResources(...a),
    reloadResource:          (...a: any[]) => mockReloadResource(...a),
    getChannelDependencies:  (...a: any[]) => mockGetChannelDependencies(...a),
    setChannelDependencies:  (...a: any[]) => mockSetChannelDependencies(...a),
    getChannelTags:          (...a: any[]) => mockGetChannelTags(...a),
    setChannelTags:          (...a: any[]) => mockSetChannelTags(...a),
    getChannelMetadata:      (...a: any[]) => mockGetChannelMetadata(...a),
    setChannelMetadata:      (...a: any[]) => mockSetChannelMetadata(...a),
  },
}));

// ---------------------------------------------------------------------------
// Mock: ChannelController
// ---------------------------------------------------------------------------
const mockGetAllChannels = jest.fn();
const mockGetChannel     = jest.fn();
const mockUpdateChannel  = jest.fn();
const mockCreateChannel  = jest.fn();

jest.mock('../../../../src/controllers/ChannelController.js', () => ({
  ChannelController: {
    getAllChannels: (...a: any[]) => mockGetAllChannels(...a),
    getChannel:    (...a: any[]) => mockGetChannel(...a),
    updateChannel: (...a: any[]) => mockUpdateChannel(...a),
    createChannel: (...a: any[]) => mockCreateChannel(...a),
  },
}));

// ---------------------------------------------------------------------------
// Mock: logging
// ---------------------------------------------------------------------------
jest.mock('../../../../src/logging/index.js', () => ({
  getLogger: jest.fn(() => ({
    info:           jest.fn(),
    warn:           jest.fn(),
    error:          jest.fn(),
    debug:          jest.fn(),
    isDebugEnabled: jest.fn(() => false),
    child:          jest.fn().mockReturnThis(),
  })),
  registerComponent: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: nodemailer (used via dynamic import in _testEmail)
//
// The ConfigurationServlet does `await import('nodemailer')` at runtime.
// Under ts-jest/CommonJS this compiles to a dynamic require(), which Jest's
// module registry intercepts via jest.mock().
//
// We expose a stable `mockSendMail` reference by using a module-level variable
// that is captured by the factory closure.  Jest hoists jest.mock() calls
// ABOVE the variable declarations, so we must use `let` and reassign inside
// the factory.  The trick: return an object whose `createTransport` always
// calls back to a jest.fn we can later reassign on the module export.
// ---------------------------------------------------------------------------
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import Express, the router, and nodemailer AFTER all mocks are registered
// ---------------------------------------------------------------------------
import express, { Express } from 'express';
import { configurationRouter } from '../../../../src/api/servlets/ConfigurationServlet.js';
// Import nodemailer so we can access the mocked createTransport via jest.mocked()
import * as nodemailerModule from 'nodemailer';

// Typed handles to the mocked nodemailer functions (resolved after imports)
const mockedCreateTransport = jest.mocked(nodemailerModule.createTransport);

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.text());

  // Replicate the real app's res.sendData helper
  app.use((_req, res, next) => {
    res.sendData = function (data: unknown) {
      this.json(data);
    };
    next();
  });

  app.use('/server', configurationRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: set up nodemailer mock for a successful send
// ---------------------------------------------------------------------------
function setupEmailMock(sendMailImpl: () => Promise<void> = () => Promise.resolve()) {
  const mockSendMail = jest.fn(sendMailImpl);
  mockedCreateTransport.mockReturnValue({ sendMail: mockSendMail } as any);
  return mockSendMail;
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
const MOCK_SERVER_ID      = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const MOCK_SETTINGS       = { clearGlobalMap: false, queueBufferSize: 1000, smtpHost: 'smtp.example.com' };
const MOCK_ENCRYPTION     = { algorithm: 'AES/CBC/PKCS5Padding', keyLength: 128 };
const MOCK_GLOBAL_SCRIPTS = { Deploy: '// deploy', Undeploy: '// undeploy' };
const MOCK_CONFIG_MAP     = { key1: { value: 'val1', comment: '' }, key2: { value: 'val2', comment: 'c' } };
const MOCK_DRIVERS        = [{ name: 'MySQL', className: 'com.mysql.cj.jdbc.Driver', template: '' }];
const MOCK_PW_REQS        = { minLength: 8, requireUpperCase: false, requireLowerCase: false, requireDigit: false, requireSpecial: false };
const MOCK_UPDATE_SETTINGS = { enabled: false, lastCheck: null };
const MOCK_RESOURCES      = [{ id: 'res-1', name: 'Default Resource', type: 'Directory', properties: {} }];
const MOCK_DEPS           = [{ dependentId: 'ch-1', dependencyId: 'ch-2' }];
const MOCK_TAGS           = [{ id: 'tag-1', name: 'Prod', backgroundColor: '#FF0000', channelIds: [] }];
const MOCK_METADATA       = { 'ch-1': { enabled: true, pruningSettings: null } };
const MOCK_CHANNELS       = [{ id: 'ch-1', name: 'Test Channel', revision: 1 }];

describe('ConfigurationServlet', () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default nodemailer to success
    setupEmailMock();
  });

  // ==========================================================================
  // Simple info / static endpoints
  // ==========================================================================

  describe('GET /server/id', () => {
    it('should return server ID as plain text', async () => {
      mockGetServerId.mockResolvedValueOnce(MOCK_SERVER_ID);

      const res = await request(app).get('/server/id');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toBe(MOCK_SERVER_ID);
      expect(mockGetServerId).toHaveBeenCalledTimes(1);
    });

    it('should return 500 when controller throws', async () => {
      mockGetServerId.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app).get('/server/id');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get server ID');
    });
  });

  describe('GET /server/version', () => {
    it('should return version as plain text', async () => {
      const res = await request(app).get('/server/version');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toBe('3.9.0');
    });
  });

  describe('GET /server/buildDate', () => {
    it('should return build date as non-empty plain text', async () => {
      const res = await request(app).get('/server/buildDate');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text.length).toBeGreaterThan(0);
    });
  });

  describe('GET /server/status', () => {
    it('should return 0 as JSON (server running)', async () => {
      const res = await request(app).get('/server/status');

      expect(res.status).toBe(200);
      expect(res.body).toBe(0);
    });
  });

  describe('GET /server/timezone', () => {
    it('should return timezone string as plain text', async () => {
      const res = await request(app).get('/server/timezone');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text.length).toBeGreaterThan(0);
    });
  });

  describe('GET /server/time', () => {
    it('should return time and timeInMillis within a reasonable window', async () => {
      const before = Date.now();
      const res = await request(app).get('/server/time');
      const after = Date.now();

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('time');
      expect(res.body).toHaveProperty('timeInMillis');
      expect(typeof res.body.time).toBe('string');
      expect(res.body.timeInMillis).toBeGreaterThanOrEqual(before);
      expect(res.body.timeInMillis).toBeLessThanOrEqual(after);
    });
  });

  describe('GET /server/jvm', () => {
    it('should return Node.js version string as plain text', async () => {
      const res = await request(app).get('/server/jvm');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toMatch(/^Node\.js v/);
    });
  });

  describe('GET /server/about', () => {
    it('should return about object with name, version and runtime', async () => {
      const res = await request(app).get('/server/about');

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Mirth Connect');
      expect(res.body.version).toBe('3.9.0');
      expect(res.body.runtime).toBe('Node.js');
      expect(res.body['runtime-version']).toMatch(/^v\d+/);
      expect(res.body.database).toBe('MySQL');
      expect(res.body.arch).toBeTruthy();
    });
  });

  describe('GET /server/charsets', () => {
    it('should return array of charset strings including UTF-8 and ISO-8859-1', async () => {
      const res = await request(app).get('/server/charsets');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toContain('UTF-8');
      expect(res.body).toContain('ISO-8859-1');
    });
  });

  describe('POST /server/_generateGUID', () => {
    it('should return a UUID v4 string as plain text', async () => {
      const res = await request(app).post('/server/_generateGUID').send();

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(res.text).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should generate different UUIDs on successive calls', async () => {
      const res1 = await request(app).post('/server/_generateGUID').send();
      const res2 = await request(app).post('/server/_generateGUID').send();

      expect(res1.text).not.toBe(res2.text);
    });
  });

  describe('GET /server/licenseInfo', () => {
    it('should return Community Edition license info', async () => {
      const res = await request(app).get('/server/licenseInfo');

      expect(res.status).toBe(200);
      expect(res.body.activated).toBe(true);
      expect(res.body.type).toBe('Community Edition');
      expect(res.body.company).toBe('Open Source');
    });
  });

  describe('GET /server/protocolsAndCipherSuites', () => {
    it('should return protocol lists containing TLSv1.2 and TLSv1.3', async () => {
      const res = await request(app).get('/server/protocolsAndCipherSuites');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.enabledProtocols)).toBe(true);
      expect(res.body.enabledProtocols).toContain('TLSv1.2');
      expect(res.body.enabledProtocols).toContain('TLSv1.3');
      expect(Array.isArray(res.body.supportedProtocols)).toBe(true);
    });
  });

  describe('GET /server/rhinoLanguageVersion', () => {
    it('should return 200 (ES6+) as JSON', async () => {
      const res = await request(app).get('/server/rhinoLanguageVersion');

      expect(res.status).toBe(200);
      expect(res.body).toBe(200);
    });
  });

  // ==========================================================================
  // GET/PUT pairs — settings
  // ==========================================================================

  describe('GET /server/settings', () => {
    it('should return server settings from controller', async () => {
      mockGetServerSettings.mockResolvedValueOnce(MOCK_SETTINGS);

      const res = await request(app).get('/server/settings');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_SETTINGS);
      expect(mockGetServerSettings).toHaveBeenCalledTimes(1);
    });

    it('should return 500 when controller throws', async () => {
      mockGetServerSettings.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app).get('/server/settings');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get server settings');
    });
  });

  describe('PUT /server/settings', () => {
    it('should pass settings body to controller and return 204', async () => {
      mockSetServerSettings.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/settings').send(MOCK_SETTINGS);

      expect(res.status).toBe(204);
      expect(mockSetServerSettings).toHaveBeenCalledWith(MOCK_SETTINGS);
    });

    it('should return 500 when controller throws', async () => {
      mockSetServerSettings.mockRejectedValueOnce(new Error('write error'));

      const res = await request(app).put('/server/settings').send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to set server settings');
    });
  });

  // ==========================================================================
  // GET /server/encryption
  // ==========================================================================

  describe('GET /server/encryption', () => {
    it('should return encryption settings from controller', async () => {
      mockGetEncryptionSettings.mockResolvedValueOnce(MOCK_ENCRYPTION);

      const res = await request(app).get('/server/encryption');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_ENCRYPTION);
      expect(mockGetEncryptionSettings).toHaveBeenCalledTimes(1);
    });

    it('should return 500 when controller throws', async () => {
      mockGetEncryptionSettings.mockRejectedValueOnce(new Error('fail'));

      const res = await request(app).get('/server/encryption');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get encryption settings');
    });
  });

  // ==========================================================================
  // GET/PUT pairs — globalScripts
  // ==========================================================================

  describe('GET /server/globalScripts', () => {
    it('should return global scripts from controller', async () => {
      mockGetGlobalScripts.mockResolvedValueOnce(MOCK_GLOBAL_SCRIPTS);

      const res = await request(app).get('/server/globalScripts');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_GLOBAL_SCRIPTS);
    });

    it('should return 500 when controller throws', async () => {
      mockGetGlobalScripts.mockRejectedValueOnce(new Error('fail'));

      const res = await request(app).get('/server/globalScripts');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get global scripts');
    });
  });

  describe('PUT /server/globalScripts', () => {
    it('should pass scripts body to controller and return 204', async () => {
      mockSetGlobalScripts.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/globalScripts').send(MOCK_GLOBAL_SCRIPTS);

      expect(res.status).toBe(204);
      expect(mockSetGlobalScripts).toHaveBeenCalledWith(MOCK_GLOBAL_SCRIPTS);
    });
  });

  // ==========================================================================
  // GET/PUT pairs — configurationMap
  // ==========================================================================

  describe('GET /server/configurationMap', () => {
    it('should return configuration map from controller', async () => {
      mockGetConfigurationMap.mockResolvedValueOnce(MOCK_CONFIG_MAP);

      const res = await request(app).get('/server/configurationMap');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_CONFIG_MAP);
    });
  });

  describe('PUT /server/configurationMap', () => {
    it('should pass configuration map to controller and return 204', async () => {
      mockSetConfigurationMap.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/configurationMap').send(MOCK_CONFIG_MAP);

      expect(res.status).toBe(204);
      expect(mockSetConfigurationMap).toHaveBeenCalledWith(MOCK_CONFIG_MAP);
    });
  });

  // ==========================================================================
  // GET/PUT pairs — databaseDrivers
  // ==========================================================================

  describe('GET /server/databaseDrivers', () => {
    it('should return database drivers from controller', async () => {
      mockGetDatabaseDrivers.mockResolvedValueOnce(MOCK_DRIVERS);

      const res = await request(app).get('/server/databaseDrivers');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_DRIVERS);
    });
  });

  describe('PUT /server/databaseDrivers', () => {
    it('should pass drivers to controller and return 204', async () => {
      mockSetDatabaseDrivers.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/databaseDrivers').send(MOCK_DRIVERS);

      expect(res.status).toBe(204);
      expect(mockSetDatabaseDrivers).toHaveBeenCalledWith(MOCK_DRIVERS);
    });
  });

  // ==========================================================================
  // GET /server/passwordRequirements
  // ==========================================================================

  describe('GET /server/passwordRequirements', () => {
    it('should return password requirements from controller', async () => {
      mockGetPasswordRequirements.mockResolvedValueOnce(MOCK_PW_REQS);

      const res = await request(app).get('/server/passwordRequirements');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_PW_REQS);
    });

    it('should return 500 when controller throws', async () => {
      mockGetPasswordRequirements.mockRejectedValueOnce(new Error('fail'));

      const res = await request(app).get('/server/passwordRequirements');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get password requirements');
    });
  });

  // ==========================================================================
  // GET/PUT pairs — updateSettings
  // ==========================================================================

  describe('GET /server/updateSettings', () => {
    it('should return update settings from controller', async () => {
      mockGetUpdateSettings.mockResolvedValueOnce(MOCK_UPDATE_SETTINGS);

      const res = await request(app).get('/server/updateSettings');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_UPDATE_SETTINGS);
    });
  });

  describe('PUT /server/updateSettings', () => {
    it('should pass update settings to controller and return 204', async () => {
      mockSetUpdateSettings.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/updateSettings').send(MOCK_UPDATE_SETTINGS);

      expect(res.status).toBe(204);
      expect(mockSetUpdateSettings).toHaveBeenCalledWith(MOCK_UPDATE_SETTINGS);
    });
  });

  // ==========================================================================
  // GET/PUT pairs — resources
  // ==========================================================================

  describe('GET /server/resources', () => {
    it('should return resources from controller', async () => {
      mockGetResources.mockResolvedValueOnce(MOCK_RESOURCES);

      const res = await request(app).get('/server/resources');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_RESOURCES);
    });
  });

  describe('PUT /server/resources', () => {
    it('should pass resources to controller and return 204', async () => {
      mockSetResources.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/resources').send(MOCK_RESOURCES);

      expect(res.status).toBe(204);
      expect(mockSetResources).toHaveBeenCalledWith(MOCK_RESOURCES);
    });
  });

  // ==========================================================================
  // POST /server/resources/:resourceId/_reload
  // ==========================================================================

  describe('POST /server/resources/:resourceId/_reload', () => {
    it('should reload a specific resource by ID and return 204', async () => {
      mockReloadResource.mockResolvedValueOnce(undefined);

      const res = await request(app).post('/server/resources/res-1/_reload').send();

      expect(res.status).toBe(204);
      expect(mockReloadResource).toHaveBeenCalledWith('res-1');
    });

    it('should return 500 when reload throws', async () => {
      mockReloadResource.mockRejectedValueOnce(new Error('reload failed'));

      const res = await request(app).post('/server/resources/res-1/_reload').send();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to reload resource');
    });
  });

  // ==========================================================================
  // GET/PUT pairs — channelDependencies
  // ==========================================================================

  describe('GET /server/channelDependencies', () => {
    it('should return channel dependencies from controller', async () => {
      mockGetChannelDependencies.mockResolvedValueOnce(MOCK_DEPS);

      const res = await request(app).get('/server/channelDependencies');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_DEPS);
    });
  });

  describe('PUT /server/channelDependencies', () => {
    it('should pass dependencies to controller and return 204', async () => {
      mockSetChannelDependencies.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/channelDependencies').send(MOCK_DEPS);

      expect(res.status).toBe(204);
      expect(mockSetChannelDependencies).toHaveBeenCalledWith(MOCK_DEPS);
    });
  });

  // ==========================================================================
  // GET/PUT pairs — channelTags
  // ==========================================================================

  describe('GET /server/channelTags', () => {
    it('should return channel tags from controller', async () => {
      mockGetChannelTags.mockResolvedValueOnce(MOCK_TAGS);

      const res = await request(app).get('/server/channelTags');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_TAGS);
    });
  });

  describe('PUT /server/channelTags', () => {
    it('should pass tags to controller and return 204', async () => {
      mockSetChannelTags.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/channelTags').send(MOCK_TAGS);

      expect(res.status).toBe(204);
      expect(mockSetChannelTags).toHaveBeenCalledWith(MOCK_TAGS);
    });
  });

  // ==========================================================================
  // GET/PUT pairs — channelMetadata
  // ==========================================================================

  describe('GET /server/channelMetadata', () => {
    it('should return channel metadata from controller', async () => {
      mockGetChannelMetadata.mockResolvedValueOnce(MOCK_METADATA);

      const res = await request(app).get('/server/channelMetadata');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(MOCK_METADATA);
    });
  });

  describe('PUT /server/channelMetadata', () => {
    it('should pass metadata to controller and return 204', async () => {
      mockSetChannelMetadata.mockResolvedValueOnce(undefined);

      const res = await request(app).put('/server/channelMetadata').send(MOCK_METADATA);

      expect(res.status).toBe(204);
      expect(mockSetChannelMetadata).toHaveBeenCalledWith(MOCK_METADATA);
    });
  });

  // ==========================================================================
  // GET /server/configuration — full backup (8 parallel controllers)
  // ==========================================================================

  describe('GET /server/configuration', () => {
    beforeEach(() => {
      mockGetServerSettings.mockResolvedValue(MOCK_SETTINGS);
      mockGetGlobalScripts.mockResolvedValue(MOCK_GLOBAL_SCRIPTS);
      mockGetConfigurationMap.mockResolvedValue(MOCK_CONFIG_MAP);
      mockGetChannelTags.mockResolvedValue(MOCK_TAGS);
      mockGetChannelMetadata.mockResolvedValue(MOCK_METADATA);
      mockGetChannelDependencies.mockResolvedValue(MOCK_DEPS);
      mockGetResources.mockResolvedValue(MOCK_RESOURCES);
      mockGetAllChannels.mockResolvedValue(MOCK_CHANNELS);
    });

    it('should aggregate all 8 data sources into a single configuration object', async () => {
      const res = await request(app).get('/server/configuration');

      expect(res.status).toBe(200);
      expect(res.body.serverSettings).toEqual(MOCK_SETTINGS);
      expect(res.body.globalScripts).toEqual(MOCK_GLOBAL_SCRIPTS);
      expect(res.body.configurationMap).toEqual(MOCK_CONFIG_MAP);
      expect(res.body.channelTags).toEqual(MOCK_TAGS);
      expect(res.body.channelMetadata).toEqual(MOCK_METADATA);
      expect(res.body.channelDependencies).toEqual(MOCK_DEPS);
      expect(res.body.resources).toEqual(MOCK_RESOURCES);
      expect(res.body.channels).toEqual(MOCK_CHANNELS);
      expect(res.body.version).toBe('3.9.0');
      expect(typeof res.body.date).toBe('string');
    });

    it('should call all 8 controller methods exactly once', async () => {
      await request(app).get('/server/configuration');

      expect(mockGetServerSettings).toHaveBeenCalledTimes(1);
      expect(mockGetGlobalScripts).toHaveBeenCalledTimes(1);
      expect(mockGetConfigurationMap).toHaveBeenCalledTimes(1);
      expect(mockGetChannelTags).toHaveBeenCalledTimes(1);
      expect(mockGetChannelMetadata).toHaveBeenCalledTimes(1);
      expect(mockGetChannelDependencies).toHaveBeenCalledTimes(1);
      expect(mockGetResources).toHaveBeenCalledTimes(1);
      expect(mockGetAllChannels).toHaveBeenCalledTimes(1);
    });

    it('should return 500 when any aggregated controller throws', async () => {
      // Override one of the already-set mocks with a rejection
      mockGetGlobalScripts.mockRejectedValue(new Error('global scripts DB error'));

      const res = await request(app).get('/server/configuration');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to get server configuration');
    });
  });

  // ==========================================================================
  // PUT /server/configuration — restore from backup
  // ==========================================================================

  describe('PUT /server/configuration', () => {
    it('should restore all sections and return 204', async () => {
      mockSetServerSettings.mockResolvedValue(undefined);
      mockSetGlobalScripts.mockResolvedValue(undefined);
      mockSetConfigurationMap.mockResolvedValue(undefined);
      mockSetChannelTags.mockResolvedValue(undefined);
      mockSetChannelMetadata.mockResolvedValue(undefined);
      mockSetChannelDependencies.mockResolvedValue(undefined);
      mockSetResources.mockResolvedValue(undefined);
      mockGetChannel
        .mockResolvedValueOnce({ id: 'ch-1', name: 'Existing Channel' })
        .mockResolvedValueOnce(null);
      mockUpdateChannel.mockResolvedValue(undefined);
      mockCreateChannel.mockResolvedValue(undefined);

      const payload = {
        serverSettings: MOCK_SETTINGS,
        globalScripts: MOCK_GLOBAL_SCRIPTS,
        configurationMap: MOCK_CONFIG_MAP,
        channelTags: MOCK_TAGS,
        channelMetadata: MOCK_METADATA,
        channelDependencies: MOCK_DEPS,
        resources: MOCK_RESOURCES,
        channels: [
          { id: 'ch-1', name: 'Existing Channel' },
          { id: 'ch-2', name: 'New Channel' },
        ],
      };

      const res = await request(app).put('/server/configuration').send(payload);

      expect(res.status).toBe(204);
      expect(mockSetServerSettings).toHaveBeenCalledWith(MOCK_SETTINGS);
      expect(mockSetGlobalScripts).toHaveBeenCalledWith(MOCK_GLOBAL_SCRIPTS);
      expect(mockSetConfigurationMap).toHaveBeenCalledWith(MOCK_CONFIG_MAP);
      expect(mockSetChannelTags).toHaveBeenCalledWith(MOCK_TAGS);
      expect(mockSetChannelMetadata).toHaveBeenCalledWith(MOCK_METADATA);
      expect(mockSetChannelDependencies).toHaveBeenCalledWith(MOCK_DEPS);
      expect(mockSetResources).toHaveBeenCalledWith(MOCK_RESOURCES);
    });

    it('should update existing channels and create new ones', async () => {
      // ch-1 exists → updateChannel; ch-2 is new → createChannel
      mockGetChannel
        .mockResolvedValueOnce({ id: 'ch-1', name: 'Existing' })
        .mockResolvedValueOnce(null);
      mockUpdateChannel.mockResolvedValue(undefined);
      mockCreateChannel.mockResolvedValue(undefined);

      const res = await request(app).put('/server/configuration').send({
        channels: [
          { id: 'ch-1', name: 'Existing' },
          { id: 'ch-2', name: 'New' },
        ],
      });

      expect(res.status).toBe(204);
      expect(mockUpdateChannel).toHaveBeenCalledTimes(1);
      expect(mockUpdateChannel).toHaveBeenCalledWith('ch-1', { id: 'ch-1', name: 'Existing' });
      expect(mockCreateChannel).toHaveBeenCalledTimes(1);
      expect(mockCreateChannel).toHaveBeenCalledWith({ id: 'ch-2', name: 'New' });
    });

    it('should skip channels section when it is not an array', async () => {
      mockSetServerSettings.mockResolvedValue(undefined);

      const res = await request(app).put('/server/configuration').send({
        serverSettings: MOCK_SETTINGS,
        channels: 'not-an-array',
      });

      expect(res.status).toBe(204);
      // Channel controller should never be called
      expect(mockGetChannel).not.toHaveBeenCalled();
      expect(mockCreateChannel).not.toHaveBeenCalled();
    });

    it('should skip optional sections when they are absent from payload', async () => {
      const res = await request(app).put('/server/configuration').send({});

      expect(res.status).toBe(204);
      expect(mockSetServerSettings).not.toHaveBeenCalled();
      expect(mockSetGlobalScripts).not.toHaveBeenCalled();
      expect(mockSetConfigurationMap).not.toHaveBeenCalled();
    });

    it('should return 500 when a controller throws during restore', async () => {
      mockSetServerSettings.mockRejectedValueOnce(new Error('write failed'));

      const res = await request(app).put('/server/configuration').send({
        serverSettings: MOCK_SETTINGS,
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to restore server configuration');
    });
  });

  // ==========================================================================
  // POST /server/_testEmail
  // ==========================================================================

  describe('POST /server/_testEmail', () => {
    it('should send a test email and return success text', async () => {
      const mockSendMail = setupEmailMock();

      const res = await request(app)
        .post('/server/_testEmail')
        .send({ host: 'smtp.example.com', port: 587, to: 'admin@example.com' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toBe('Successfully sent test email.');
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('should pass all SMTP options (host, port, secure, auth) to createTransport', async () => {
      setupEmailMock();

      await request(app)
        .post('/server/_testEmail')
        .send({
          host: 'smtp.mycompany.com',
          port: 465,
          secure: true,
          username: 'user@mycompany.com',
          password: 'secret',
          from: 'mirth@mycompany.com',
          to: 'ops@mycompany.com',
        });

      expect(mockedCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.mycompany.com',
          port: 465,
          secure: true,
          auth: { user: 'user@mycompany.com', pass: 'secret' },
        })
      );
    });

    it('should omit auth when username is not provided', async () => {
      setupEmailMock();

      await request(app)
        .post('/server/_testEmail')
        .send({ host: 'smtp.open.com', to: 'admin@example.com' });

      expect(mockedCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined })
      );
    });

    it('should use default from address when from is not supplied', async () => {
      const mockSendMail = setupEmailMock();

      await request(app)
        .post('/server/_testEmail')
        .send({ host: 'smtp.example.com', to: 'ops@example.com' });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'mirth@localhost' })
      );
    });

    it('should return 400 when host is missing', async () => {
      const res = await request(app)
        .post('/server/_testEmail')
        .send({ to: 'admin@example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SMTP host and recipient (to) are required');
      expect(mockedCreateTransport).not.toHaveBeenCalled();
    });

    it('should return 400 when to is missing', async () => {
      const res = await request(app)
        .post('/server/_testEmail')
        .send({ host: 'smtp.example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SMTP host and recipient (to) are required');
    });

    it('should return 400 when both host and to are missing', async () => {
      const res = await request(app)
        .post('/server/_testEmail')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SMTP host and recipient (to) are required');
    });

    it('should return plain-text failure message when sendMail rejects', async () => {
      setupEmailMock(() => Promise.reject(new Error('Connection refused')));

      const res = await request(app)
        .post('/server/_testEmail')
        .send({ host: 'bad-host.example.com', to: 'admin@example.com' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('Failed to send test email:');
      expect(res.text).toContain('Connection refused');
    });
  });
});
