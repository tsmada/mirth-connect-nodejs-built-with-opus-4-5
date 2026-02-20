/**
 * Authorization Wiring Tests
 *
 * Verifies that all servlets have authorize() middleware wired on every route
 * with the correct operations.
 */

import * as fs from 'fs';
import * as path from 'path';

const SERVLET_DIR = path.join(process.cwd(), 'src/api/servlets');

/** Read source and normalize whitespace so tests are formatting-independent */
function readSource(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
    .replace(/\s+/g, ' ')   // collapse all whitespace to single space
    .replace(/\( /g, '(')   // remove space after open paren
    .replace(/ \)/g, ')');   // remove space before close paren
}

describe('ChannelServlet authorization', () => {
  const source = readSource(path.join(SERVLET_DIR, 'ChannelServlet.ts'));

  it('imports authorize middleware', () => {
    expect(source).toContain("import { authorize }");
  });

  it('imports all required operation constants', () => {
    expect(source).toContain('CHANNEL_GET_CHANNELS');
    expect(source).toContain('CHANNEL_GET_CHANNEL');
    expect(source).toContain('CHANNEL_GET_CHANNEL_SUMMARY');
    expect(source).toContain('CHANNEL_CREATE');
    expect(source).toContain('CHANNEL_UPDATE');
    expect(source).toContain('CHANNEL_REMOVE');
    expect(source).toContain('CHANNEL_GET_IDS_AND_NAMES');
  });

  it('has authorize on GET / (get all channels)', () => {
    expect(source).toContain("channelRouter.get('/', authorize({ operation: CHANNEL_GET_CHANNELS })");
  });

  it('has authorize on POST /_getChannels', () => {
    expect(source).toContain("channelRouter.post('/_getChannels', authorize({ operation: CHANNEL_GET_CHANNELS })");
  });

  it('has authorize on GET /idsAndNames', () => {
    expect(source).toContain("channelRouter.get('/idsAndNames', authorize({ operation: CHANNEL_GET_IDS_AND_NAMES })");
  });

  it('has authorize on GET /:channelId with channel check', () => {
    expect(source).toContain(
      "channelRouter.get('/:channelId', authorize({ operation: CHANNEL_GET_CHANNEL, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /_getSummary', () => {
    expect(source).toContain("channelRouter.post('/_getSummary', authorize({ operation: CHANNEL_GET_CHANNEL_SUMMARY })");
  });

  it('has authorize on POST / (create channel)', () => {
    expect(source).toContain("channelRouter.post('/', authorize({ operation: CHANNEL_CREATE })");
  });

  it('has authorize on PUT /:channelId with channel check', () => {
    expect(source).toContain(
      "channelRouter.put('/:channelId', authorize({ operation: CHANNEL_UPDATE, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on DELETE /:channelId with channel check', () => {
    expect(source).toContain(
      "channelRouter.delete('/:channelId', authorize({ operation: CHANNEL_REMOVE, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on DELETE / (bulk delete)', () => {
    expect(source).toContain("channelRouter.delete('/', authorize({ operation: CHANNEL_REMOVE })");
  });

  it('has authorize on POST /_removeChannels', () => {
    expect(source).toContain("channelRouter.post('/_removeChannels', authorize({ operation: CHANNEL_REMOVE })");
  });

  it('has authorize on POST /_setEnabled', () => {
    expect(source).toContain("channelRouter.post('/_setEnabled', authorize({ operation: CHANNEL_UPDATE })");
  });

  it('has authorize on POST /:channelId/enabled/:enabled with channel check', () => {
    expect(source).toContain(
      "channelRouter.post('/:channelId/enabled/:enabled', authorize({ operation: CHANNEL_UPDATE, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on GET /:channelId/connectorNames with channel check', () => {
    expect(source).toContain(
      "channelRouter.get('/:channelId/connectorNames', authorize({ operation: CHANNEL_GET_CHANNEL, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on GET /:channelId/metaDataColumns with channel check', () => {
    expect(source).toContain(
      "channelRouter.get('/:channelId/metaDataColumns', authorize({ operation: CHANNEL_GET_CHANNEL, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has no routes without authorize middleware', () => {
    // Count route registrations vs authorize calls
    const routeRegistrations = (source.match(/channelRouter\.(get|post|put|delete)\(/g) || []).length;
    const authorizeCalls = (source.match(/authorize\(\{/g) || []).length;
    expect(authorizeCalls).toBe(routeRegistrations);
  });
});

describe('ChannelStatusServlet authorization', () => {
  const source = readSource(path.join(SERVLET_DIR, 'ChannelStatusServlet.ts'));

  it('imports authorize middleware', () => {
    expect(source).toContain("import { authorize }");
  });

  it('imports all required operation constants', () => {
    expect(source).toContain('CHANNEL_STATUS_GET');
    expect(source).toContain('CHANNEL_STATUS_GET_ALL');
    expect(source).toContain('CHANNEL_STATUS_GET_INITIAL');
    expect(source).toContain('CHANNEL_START');
    expect(source).toContain('CHANNEL_STOP');
    expect(source).toContain('CHANNEL_PAUSE');
    expect(source).toContain('CHANNEL_RESUME');
    expect(source).toContain('CHANNEL_HALT');
  });

  it('has authorize on GET /:channelId/status with channel check', () => {
    expect(source).toContain(
      "channelStatusRouter.get('/:channelId/status', authorize({ operation: CHANNEL_STATUS_GET, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on GET /statuses', () => {
    expect(source).toContain("channelStatusRouter.get('/statuses', authorize({ operation: CHANNEL_STATUS_GET_ALL })");
  });

  it('has authorize on POST /statuses/_getChannelStatusList', () => {
    expect(source).toContain(
      "channelStatusRouter.post('/statuses/_getChannelStatusList', authorize({ operation: CHANNEL_STATUS_GET_ALL })"
    );
  });

  it('has authorize on GET /statuses/initial', () => {
    expect(source).toContain("channelStatusRouter.get('/statuses/initial', authorize({ operation: CHANNEL_STATUS_GET_INITIAL })");
  });

  it('has authorize on POST /:channelId/_start with channel check', () => {
    expect(source).toContain(
      "channelStatusRouter.post('/:channelId/_start', authorize({ operation: CHANNEL_START, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /_start (bulk)', () => {
    expect(source).toContain("channelStatusRouter.post('/_start', authorize({ operation: CHANNEL_START })");
  });

  it('has authorize on POST /:channelId/_stop with channel check', () => {
    expect(source).toContain(
      "channelStatusRouter.post('/:channelId/_stop', authorize({ operation: CHANNEL_STOP, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /_stop (bulk)', () => {
    expect(source).toContain("channelStatusRouter.post('/_stop', authorize({ operation: CHANNEL_STOP })");
  });

  it('has authorize on POST /:channelId/_halt with channel check', () => {
    expect(source).toContain(
      "channelStatusRouter.post('/:channelId/_halt', authorize({ operation: CHANNEL_HALT, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /_halt (bulk)', () => {
    expect(source).toContain("channelStatusRouter.post('/_halt', authorize({ operation: CHANNEL_HALT })");
  });

  it('has authorize on POST /:channelId/_pause with channel check', () => {
    expect(source).toContain(
      "channelStatusRouter.post('/:channelId/_pause', authorize({ operation: CHANNEL_PAUSE, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /_pause (bulk)', () => {
    expect(source).toContain("channelStatusRouter.post('/_pause', authorize({ operation: CHANNEL_PAUSE })");
  });

  it('has authorize on POST /:channelId/_resume with channel check', () => {
    expect(source).toContain(
      "channelStatusRouter.post('/:channelId/_resume', authorize({ operation: CHANNEL_RESUME, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /_resume (bulk)', () => {
    expect(source).toContain("channelStatusRouter.post('/_resume', authorize({ operation: CHANNEL_RESUME })");
  });

  it('has authorize on POST /:channelId/connector/:metaDataId/_start with channel check', () => {
    expect(source).toContain(
      "channelStatusRouter.post('/:channelId/connector/:metaDataId/_start', authorize({ operation: CHANNEL_START, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /:channelId/connector/:metaDataId/_stop with channel check', () => {
    expect(source).toContain(
      "channelStatusRouter.post('/:channelId/connector/:metaDataId/_stop', authorize({ operation: CHANNEL_STOP, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has no routes without authorize middleware', () => {
    const routeRegistrations = (source.match(/channelStatusRouter\.(get|post|put|delete)\(/g) || []).length;
    const authorizeCalls = (source.match(/authorize\(\{/g) || []).length;
    expect(authorizeCalls).toBe(routeRegistrations);
  });
});

describe('EngineServlet authorization', () => {
  const source = readSource(path.join(SERVLET_DIR, 'EngineServlet.ts'));

  it('imports authorize middleware', () => {
    expect(source).toContain("import { authorize }");
  });

  it('imports all required operation constants', () => {
    expect(source).toContain('ENGINE_DEPLOY');
    expect(source).toContain('ENGINE_UNDEPLOY');
    expect(source).toContain('ENGINE_REDEPLOY_ALL');
  });

  it('has authorize on POST /_redeployAll', () => {
    expect(source).toContain("engineRouter.post('/_redeployAll', authorize({ operation: ENGINE_REDEPLOY_ALL })");
  });

  it('has authorize on POST /:channelId/_deploy with channel check', () => {
    expect(source).toContain(
      "engineRouter.post('/:channelId/_deploy', authorize({ operation: ENGINE_DEPLOY, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /_deploy (bulk)', () => {
    expect(source).toContain("engineRouter.post('/_deploy', authorize({ operation: ENGINE_DEPLOY })");
  });

  it('has authorize on POST /:channelId/_undeploy with channel check', () => {
    expect(source).toContain(
      "engineRouter.post('/:channelId/_undeploy', authorize({ operation: ENGINE_UNDEPLOY, checkAuthorizedChannelId: 'channelId' })"
    );
  });

  it('has authorize on POST /_undeploy (bulk)', () => {
    expect(source).toContain("engineRouter.post('/_undeploy', authorize({ operation: ENGINE_UNDEPLOY })");
  });

  it('has no routes without authorize middleware', () => {
    const routeRegistrations = (source.match(/engineRouter\.(get|post|put|delete)\(/g) || []).length;
    const authorizeCalls = (source.match(/authorize\(\{/g) || []).length;
    expect(authorizeCalls).toBe(routeRegistrations);
  });
});

// ============================================================================
// ConfigurationServlet
// ============================================================================

describe('ConfigurationServlet authorization', () => {
  const source = readSource(path.join(SERVLET_DIR, 'ConfigurationServlet.ts'));

  it('imports authorize middleware', () => {
    expect(source).toContain("import { authorize }");
  });

  it('imports all required operation constants', () => {
    const ops = [
      'CONFIG_GET_SERVER_ID', 'CONFIG_GET_VERSION', 'CONFIG_GET_BUILD_DATE',
      'CONFIG_GET_STATUS', 'CONFIG_GET_TIMEZONE', 'CONFIG_GET_TIME',
      'CONFIG_GET_JVM', 'CONFIG_GET_ABOUT', 'CONFIG_GET_SETTINGS',
      'CONFIG_SET_SETTINGS', 'CONFIG_GET_ENCRYPTION', 'CONFIG_GET_CHARSETS',
      'CONFIG_GENERATE_GUID', 'CONFIG_GET_GLOBAL_SCRIPTS', 'CONFIG_SET_GLOBAL_SCRIPTS',
      'CONFIG_GET_CONFIG_MAP', 'CONFIG_SET_CONFIG_MAP', 'CONFIG_GET_DB_DRIVERS',
      'CONFIG_SET_DB_DRIVERS', 'CONFIG_GET_PASSWORD_REQUIREMENTS',
      'CONFIG_GET_UPDATE_SETTINGS', 'CONFIG_SET_UPDATE_SETTINGS',
      'CONFIG_GET_LICENSE', 'CONFIG_GET_RESOURCES', 'CONFIG_SET_RESOURCES',
      'CONFIG_RELOAD_RESOURCE', 'CONFIG_GET_CHANNEL_DEPS', 'CONFIG_SET_CHANNEL_DEPS',
      'CONFIG_GET_CHANNEL_TAGS', 'CONFIG_SET_CHANNEL_TAGS',
      'CONFIG_GET_CHANNEL_METADATA', 'CONFIG_SET_CHANNEL_METADATA',
      'CONFIG_GET_PROTOCOLS', 'CONFIG_GET_RHINO_VERSION',
    ];
    for (const op of ops) {
      expect(source).toContain(op);
    }
  });

  it('has authorize on GET /id', () => {
    expect(source).toContain("configurationRouter.get('/id', authorize({ operation: CONFIG_GET_SERVER_ID })");
  });

  it('has authorize on GET /version', () => {
    expect(source).toContain("configurationRouter.get('/version', authorize({ operation: CONFIG_GET_VERSION })");
  });

  it('has authorize on GET /buildDate', () => {
    expect(source).toContain("configurationRouter.get('/buildDate', authorize({ operation: CONFIG_GET_BUILD_DATE })");
  });

  it('has authorize on GET /status', () => {
    expect(source).toContain("configurationRouter.get('/status', authorize({ operation: CONFIG_GET_STATUS })");
  });

  it('has authorize on GET /timezone', () => {
    expect(source).toContain("configurationRouter.get('/timezone', authorize({ operation: CONFIG_GET_TIMEZONE })");
  });

  it('has authorize on GET /time', () => {
    expect(source).toContain("configurationRouter.get('/time', authorize({ operation: CONFIG_GET_TIME })");
  });

  it('has authorize on GET /jvm', () => {
    expect(source).toContain("configurationRouter.get('/jvm', authorize({ operation: CONFIG_GET_JVM })");
  });

  it('has authorize on GET /about', () => {
    expect(source).toContain("configurationRouter.get('/about', authorize({ operation: CONFIG_GET_ABOUT })");
  });

  it('has authorize on GET /settings', () => {
    expect(source).toContain("configurationRouter.get('/settings', authorize({ operation: CONFIG_GET_SETTINGS })");
  });

  it('has authorize on PUT /settings', () => {
    expect(source).toContain("configurationRouter.put('/settings', authorize({ operation: CONFIG_SET_SETTINGS })");
  });

  it('has authorize on GET /encryption', () => {
    expect(source).toContain("configurationRouter.get('/encryption', authorize({ operation: CONFIG_GET_ENCRYPTION })");
  });

  it('has authorize on GET /charsets', () => {
    expect(source).toContain("configurationRouter.get('/charsets', authorize({ operation: CONFIG_GET_CHARSETS })");
  });

  it('has authorize on POST /_generateGUID', () => {
    expect(source).toContain("configurationRouter.post('/_generateGUID', authorize({ operation: CONFIG_GENERATE_GUID })");
  });

  it('has authorize on GET /globalScripts', () => {
    expect(source).toContain("configurationRouter.get('/globalScripts', authorize({ operation: CONFIG_GET_GLOBAL_SCRIPTS })");
  });

  it('has authorize on PUT /globalScripts', () => {
    expect(source).toContain("configurationRouter.put('/globalScripts', authorize({ operation: CONFIG_SET_GLOBAL_SCRIPTS })");
  });

  it('has authorize on GET /configurationMap', () => {
    expect(source).toContain("configurationRouter.get('/configurationMap', authorize({ operation: CONFIG_GET_CONFIG_MAP })");
  });

  it('has authorize on PUT /configurationMap', () => {
    expect(source).toContain("configurationRouter.put('/configurationMap', authorize({ operation: CONFIG_SET_CONFIG_MAP })");
  });

  it('has authorize on GET /databaseDrivers', () => {
    expect(source).toContain("configurationRouter.get('/databaseDrivers', authorize({ operation: CONFIG_GET_DB_DRIVERS })");
  });

  it('has authorize on PUT /databaseDrivers', () => {
    expect(source).toContain("configurationRouter.put('/databaseDrivers', authorize({ operation: CONFIG_SET_DB_DRIVERS })");
  });

  it('has authorize on GET /passwordRequirements', () => {
    expect(source).toContain("configurationRouter.get('/passwordRequirements', authorize({ operation: CONFIG_GET_PASSWORD_REQUIREMENTS })");
  });

  it('has authorize on GET /updateSettings', () => {
    expect(source).toContain("configurationRouter.get('/updateSettings', authorize({ operation: CONFIG_GET_UPDATE_SETTINGS })");
  });

  it('has authorize on PUT /updateSettings', () => {
    expect(source).toContain("configurationRouter.put('/updateSettings', authorize({ operation: CONFIG_SET_UPDATE_SETTINGS })");
  });

  it('has authorize on GET /licenseInfo', () => {
    expect(source).toContain("configurationRouter.get('/licenseInfo', authorize({ operation: CONFIG_GET_LICENSE })");
  });

  it('has authorize on GET /resources', () => {
    expect(source).toContain("configurationRouter.get('/resources', authorize({ operation: CONFIG_GET_RESOURCES })");
  });

  it('has authorize on PUT /resources', () => {
    expect(source).toContain("configurationRouter.put('/resources', authorize({ operation: CONFIG_SET_RESOURCES })");
  });

  it('has authorize on POST /resources/:resourceId/_reload', () => {
    expect(source).toContain("configurationRouter.post('/resources/:resourceId/_reload', authorize({ operation: CONFIG_RELOAD_RESOURCE })");
  });

  it('has authorize on GET /channelDependencies', () => {
    expect(source).toContain("configurationRouter.get('/channelDependencies', authorize({ operation: CONFIG_GET_CHANNEL_DEPS })");
  });

  it('has authorize on PUT /channelDependencies', () => {
    expect(source).toContain("configurationRouter.put('/channelDependencies', authorize({ operation: CONFIG_SET_CHANNEL_DEPS })");
  });

  it('has authorize on GET /channelTags', () => {
    expect(source).toContain("configurationRouter.get('/channelTags', authorize({ operation: CONFIG_GET_CHANNEL_TAGS })");
  });

  it('has authorize on PUT /channelTags', () => {
    expect(source).toContain("configurationRouter.put('/channelTags', authorize({ operation: CONFIG_SET_CHANNEL_TAGS })");
  });

  it('has authorize on GET /channelMetadata', () => {
    expect(source).toContain("configurationRouter.get('/channelMetadata', authorize({ operation: CONFIG_GET_CHANNEL_METADATA })");
  });

  it('has authorize on PUT /channelMetadata', () => {
    expect(source).toContain("configurationRouter.put('/channelMetadata', authorize({ operation: CONFIG_SET_CHANNEL_METADATA })");
  });

  it('has authorize on GET /protocolsAndCipherSuites', () => {
    expect(source).toContain("configurationRouter.get('/protocolsAndCipherSuites', authorize({ operation: CONFIG_GET_PROTOCOLS })");
  });

  it('has authorize on GET /rhinoLanguageVersion', () => {
    expect(source).toContain("configurationRouter.get('/rhinoLanguageVersion', authorize({ operation: CONFIG_GET_RHINO_VERSION })");
  });

  it('has no routes without authorize middleware', () => {
    const routeRegistrations = (source.match(/configurationRouter\.(get|post|put|delete)\(/g) || []).length;
    const authorizeCalls = (source.match(/authorize\(\{/g) || []).length;
    expect(authorizeCalls).toBe(routeRegistrations);
  });
});

// ============================================================================
// UserServlet
// ============================================================================

describe('UserServlet authorization', () => {
  const source = readSource(path.join(SERVLET_DIR, 'UserServlet.ts'));

  it('imports authorize middleware', () => {
    expect(source).toContain("import { authorize }");
  });

  it('imports all required operation constants', () => {
    const ops = [
      'USER_GET', 'USER_GET_ALL', 'USER_CREATE', 'USER_UPDATE', 'USER_REMOVE',
      'USER_CHECK_PASSWORD', 'USER_UPDATE_PASSWORD',
      'USER_GET_PREFERENCES', 'USER_SET_PREFERENCES', 'USER_IS_LOGGED_IN',
    ];
    for (const op of ops) {
      expect(source).toContain(op);
    }
  });

  it('does NOT add authorize to login route', () => {
    // Login route has rate limiter but should NOT have authorize middleware
    expect(source).toContain("userRouter.post('/_login', loginLimiter, async");
    expect(source).not.toContain("userRouter.post('/_login', authorize");
  });

  it('does NOT add authorize to logout route', () => {
    expect(source).toContain("userRouter.post('/_logout', authMiddleware");
    // logout should NOT have authorize middleware
    expect(source).not.toContain("userRouter.post('/_logout', authorize");
  });

  it('has authorize on GET / (get all users)', () => {
    expect(source).toContain("userRouter.get('/', authMiddleware({ required: true }), authorize({ operation: USER_GET_ALL })");
  });

  it('has authorize on GET /current with dontCheckAuthorized', () => {
    expect(source).toContain("userRouter.get('/current', authMiddleware({ required: true }), authorize({ operation: USER_GET, dontCheckAuthorized: true })");
  });

  it('has authorize on GET /:userIdOrName', () => {
    expect(source).toContain("userRouter.get('/:userIdOrName', authMiddleware({ required: true }), authorize({ operation: USER_GET })");
  });

  it('has authorize on POST / (create user)', () => {
    expect(source).toContain("userRouter.post('/', authMiddleware({ required: true }), authorize({ operation: USER_CREATE })");
  });

  it('has authorize on PUT /:userId with checkAuthorizedUserId', () => {
    expect(source).toContain("userRouter.put('/:userId', authMiddleware({ required: true }), authorize({ operation: USER_UPDATE, checkAuthorizedUserId: 'userId' })");
  });

  it('has authorize on DELETE /:userId', () => {
    expect(source).toContain("userRouter.delete('/:userId', authMiddleware({ required: true }), authorize({ operation: USER_REMOVE })");
  });

  it('has authorize on GET /:userId/loggedIn', () => {
    expect(source).toContain("userRouter.get('/:userId/loggedIn', authMiddleware({ required: true }), authorize({ operation: USER_IS_LOGGED_IN })");
  });

  it('has authorize on PUT /:userId/password with checkAuthorizedUserId', () => {
    expect(source).toContain("userRouter.put('/:userId/password', authMiddleware({ required: true }), authorize({ operation: USER_UPDATE_PASSWORD, checkAuthorizedUserId: 'userId' })");
  });

  it('has authorize on POST /_checkPassword', () => {
    expect(source).toContain("userRouter.post('/_checkPassword', authMiddleware({ required: true }), authorize({ operation: USER_CHECK_PASSWORD })");
  });

  it('has authorize on GET /:userId/preferences with checkAuthorizedUserId', () => {
    expect(source).toContain("userRouter.get('/:userId/preferences', authMiddleware({ required: true }), authorize({ operation: USER_GET_PREFERENCES, checkAuthorizedUserId: 'userId' })");
  });

  it('has authorize on PUT /:userId/preferences with checkAuthorizedUserId', () => {
    expect(source).toContain("userRouter.put('/:userId/preferences', authMiddleware({ required: true }), authorize({ operation: USER_SET_PREFERENCES, checkAuthorizedUserId: 'userId' })");
  });

  it('every authenticated route has authorize (excluding login/logout)', () => {
    // Count routes that have authMiddleware({ required: true }) and authorize
    const authRoutes = (source.match(/authMiddleware\(\{ required: true \}\)/g) || []).length;
    const authorizeOnAuthRoutes = (source.match(/authMiddleware\(\{ required: true \}\),\s*authorize\(\{/g) || []).length;
    expect(authorizeOnAuthRoutes).toBe(authRoutes);
  });
});

// ============================================================================
// CodeTemplateServlet
// ============================================================================

describe('CodeTemplateServlet authorization', () => {
  const PLUGIN_DIR = path.join(process.cwd(), 'src/plugins/codetemplates');
  const source = readSource(path.join(PLUGIN_DIR, 'CodeTemplateServlet.ts'));

  it('imports authorize middleware', () => {
    expect(source).toContain("import { authorize }");
  });

  it('imports all required operation constants', () => {
    const ops = [
      'CODE_TEMPLATE_GET', 'CODE_TEMPLATE_GET_ALL',
      'CODE_TEMPLATE_UPDATE', 'CODE_TEMPLATE_REMOVE',
      'CODE_TEMPLATE_LIBRARY_GET', 'CODE_TEMPLATE_LIBRARY_GET_ALL',
      'CODE_TEMPLATE_LIBRARY_UPDATE',
    ];
    for (const op of ops) {
      expect(source).toContain(op);
    }
  });

  it('has authorize on GET /codeTemplateLibraries', () => {
    expect(source).toContain("codeTemplateRouter.get('/codeTemplateLibraries', authorize({ operation: CODE_TEMPLATE_LIBRARY_GET_ALL })");
  });

  it('has authorize on POST /codeTemplateLibraries/_getCodeTemplateLibraries', () => {
    expect(source).toContain("'/codeTemplateLibraries/_getCodeTemplateLibraries',");
    expect(source).toContain("authorize({ operation: CODE_TEMPLATE_LIBRARY_GET_ALL })");
  });

  it('has authorize on GET /codeTemplateLibraries/:libraryId', () => {
    expect(source).toContain("codeTemplateRouter.get('/codeTemplateLibraries/:libraryId', authorize({ operation: CODE_TEMPLATE_LIBRARY_GET })");
  });

  it('has authorize on PUT /codeTemplateLibraries', () => {
    expect(source).toContain("codeTemplateRouter.put('/codeTemplateLibraries', authorize({ operation: CODE_TEMPLATE_LIBRARY_UPDATE })");
  });

  it('has authorize on GET /codeTemplates', () => {
    expect(source).toContain("codeTemplateRouter.get('/codeTemplates', authorize({ operation: CODE_TEMPLATE_GET_ALL })");
  });

  it('has authorize on POST /codeTemplates/_getCodeTemplates', () => {
    expect(source).toContain("codeTemplateRouter.post('/codeTemplates/_getCodeTemplates', authorize({ operation: CODE_TEMPLATE_GET_ALL })");
  });

  it('has authorize on GET /codeTemplates/:codeTemplateId', () => {
    expect(source).toContain("codeTemplateRouter.get('/codeTemplates/:codeTemplateId', authorize({ operation: CODE_TEMPLATE_GET })");
  });

  it('has authorize on POST /codeTemplates/_getSummary', () => {
    expect(source).toContain("codeTemplateRouter.post('/codeTemplates/_getSummary', authorize({ operation: CODE_TEMPLATE_GET_ALL })");
  });

  it('has authorize on PUT /codeTemplates/:codeTemplateId', () => {
    expect(source).toContain("codeTemplateRouter.put('/codeTemplates/:codeTemplateId', authorize({ operation: CODE_TEMPLATE_UPDATE })");
  });

  it('has authorize on DELETE /codeTemplates/:codeTemplateId', () => {
    expect(source).toContain("codeTemplateRouter.delete('/codeTemplates/:codeTemplateId', authorize({ operation: CODE_TEMPLATE_REMOVE })");
  });

  it('has authorize on POST /codeTemplateLibraries/_bulkUpdate', () => {
    expect(source).toContain("codeTemplateRouter.post('/codeTemplateLibraries/_bulkUpdate', multipartFormMiddleware(), authorize({ operation: CODE_TEMPLATE_LIBRARY_UPDATE })");
  });

  it('has no routes without authorize middleware', () => {
    const routeRegistrations = (source.match(/codeTemplateRouter\.(get|post|put|delete)\(/g) || []).length;
    const authorizeCalls = (source.match(/authorize\(\{/g) || []).length;
    expect(authorizeCalls).toBe(routeRegistrations);
  });
});
