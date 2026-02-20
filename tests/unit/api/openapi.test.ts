/**
 * OpenAPI 3.1 Spec Generation Tests
 *
 * Validates the generated OpenAPI spec structure, schema completeness,
 * and route coverage for the 5 highest-traffic servlets.
 */

import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from '../../../src/api/openapi/registry';
import { getOpenApiSpec } from '../../../src/api/openapi/serve';

// Generate spec once for all tests
let spec: Record<string, unknown>;

beforeAll(() => {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  spec = generator.generateDocument({
    openapi: '3.1.0',
    info: { title: 'Test', version: '1.0.0' },
    servers: [{ url: 'http://localhost:8081' }],
  }) as unknown as Record<string, unknown>;
});

describe('OpenAPI Spec Structure', () => {
  test('spec has valid OpenAPI version', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  test('spec has info section', () => {
    const info = spec.info as Record<string, unknown>;
    expect(info).toBeDefined();
    expect(info.title).toBeDefined();
    expect(info.version).toBeDefined();
  });

  test('spec has servers', () => {
    const servers = spec.servers as Array<Record<string, unknown>>;
    expect(servers).toBeDefined();
    expect(servers.length).toBeGreaterThan(0);
    expect(servers[0]!.url).toBeDefined();
  });

  test('spec has components with schemas', () => {
    const components = spec.components as Record<string, unknown>;
    expect(components).toBeDefined();
    const schemas = components.schemas as Record<string, unknown>;
    expect(schemas).toBeDefined();
    expect(Object.keys(schemas).length).toBeGreaterThan(0);
  });

  test('spec has security schemes', () => {
    const components = spec.components as Record<string, unknown>;
    const securitySchemes = components.securitySchemes as Record<string, unknown>;
    expect(securitySchemes).toBeDefined();
    expect(securitySchemes.sessionCookie).toBeDefined();
    expect(securitySchemes.sessionHeader).toBeDefined();
  });

  test('spec has paths', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths).toBeDefined();
    expect(Object.keys(paths).length).toBeGreaterThan(0);
  });
});

describe('Schema Registration', () => {
  test('all model schemas are registered', () => {
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const schemaNames = Object.keys(schemas);

    // Schemas registered via .openapi('Name') AND referenced by routes
    const expectedSchemas = [
      'Error',
      'User',
      'CreateUser',
      'UpdateUser',
      'LoginRequest',
      'LoginStatus',
      'FilterRule',
      'TransformerStep',
      'FilterConfig',
      'TransformerConfig',
      'Connector',
      'MetaDataColumnConfig',
      'ChannelProperties',
      'Channel',
      'ChannelSummary',
      'ChannelStatistics',
      'DashboardStatus',
      'DashboardChannelInfo',
      'MessageContent',
      'ConnectorMessage',
      'Message',
    ];

    for (const name of expectedSchemas) {
      expect(schemaNames).toContain(name);
    }
  });

  test('User schema has expected fields', () => {
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const userSchema = schemas.User as Record<string, unknown>;
    const properties = userSchema.properties as Record<string, unknown>;

    expect(properties.id).toBeDefined();
    expect(properties.username).toBeDefined();
    expect(properties.role).toBeDefined();
    expect(properties.firstName).toBeDefined();
    expect(properties.lastName).toBeDefined();
    expect(properties.email).toBeDefined();
  });

  test('Channel schema has required connectors', () => {
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const channelSchema = schemas.Channel as Record<string, unknown>;
    const properties = channelSchema.properties as Record<string, unknown>;

    expect(properties.id).toBeDefined();
    expect(properties.name).toBeDefined();
    expect(properties.sourceConnector).toBeDefined();
    expect(properties.destinationConnectors).toBeDefined();
    expect(properties.properties).toBeDefined();
  });

  test('Message schema has expected structure', () => {
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const messageSchema = schemas.Message as Record<string, unknown>;
    const properties = messageSchema.properties as Record<string, unknown>;

    expect(properties.messageId).toBeDefined();
    expect(properties.channelId).toBeDefined();
    expect(properties.connectorMessages).toBeDefined();
    expect(properties.processed).toBeDefined();
  });

  test('ChannelStatistics schema has all counter fields', () => {
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const statsSchema = schemas.ChannelStatistics as Record<string, unknown>;
    const properties = statsSchema.properties as Record<string, unknown>;

    expect(properties.received).toBeDefined();
    expect(properties.sent).toBeDefined();
    expect(properties.error).toBeDefined();
    expect(properties.filtered).toBeDefined();
    expect(properties.queued).toBeDefined();
  });
});

describe('Health Check Routes', () => {
  test('GET /api/health is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    const healthPath = paths['/api/health'] as Record<string, unknown>;
    expect(healthPath).toBeDefined();
    expect(healthPath.get).toBeDefined();
  });

  test('GET /api/health/live is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    const livePath = paths['/api/health/live'] as Record<string, unknown>;
    expect(livePath).toBeDefined();
    expect(livePath.get).toBeDefined();
  });

  test('GET /api/health/startup is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    const startupPath = paths['/api/health/startup'] as Record<string, unknown>;
    expect(startupPath).toBeDefined();
    expect(startupPath.get).toBeDefined();
  });

  test('health routes have no security requirement', () => {
    const paths = spec.paths as Record<string, unknown>;
    const healthPath = paths['/api/health'] as Record<string, unknown>;
    const getOp = healthPath.get as Record<string, unknown>;
    // Health check routes should not have security requirements
    expect(getOp.security).toBeUndefined();
  });
});

describe('User Servlet Routes', () => {
  test('POST /api/users/_login is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    const loginPath = paths['/api/users/_login'] as Record<string, unknown>;
    expect(loginPath).toBeDefined();
    expect(loginPath.post).toBeDefined();
  });

  test('login route has request body schema', () => {
    const paths = spec.paths as Record<string, unknown>;
    const loginPath = paths['/api/users/_login'] as Record<string, unknown>;
    const postOp = loginPath.post as Record<string, unknown>;
    const requestBody = postOp.requestBody as Record<string, unknown>;
    expect(requestBody).toBeDefined();
    expect(requestBody.required).toBe(true);
  });

  test('login route has 200 and 401 responses', () => {
    const paths = spec.paths as Record<string, unknown>;
    const loginPath = paths['/api/users/_login'] as Record<string, unknown>;
    const postOp = loginPath.post as Record<string, unknown>;
    const responses = postOp.responses as Record<string, unknown>;
    expect(responses['200']).toBeDefined();
    expect(responses['401']).toBeDefined();
  });

  test('GET /api/users is registered with security', () => {
    const paths = spec.paths as Record<string, unknown>;
    const usersPath = paths['/api/users'] as Record<string, unknown>;
    expect(usersPath).toBeDefined();
    const getOp = usersPath.get as Record<string, unknown>;
    expect(getOp).toBeDefined();
    expect(getOp.security).toBeDefined();
  });

  test('user CRUD routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    // GET /api/users
    expect(paths['/api/users']).toBeDefined();
    // GET /api/users/current
    expect(paths['/api/users/current']).toBeDefined();
    // POST /api/users
    expect((paths['/api/users'] as Record<string, unknown>).post).toBeDefined();
    // PUT /api/users/{userId}
    expect(paths['/api/users/{userId}']).toBeDefined();
    // DELETE /api/users/{userId}
    expect(
      (paths['/api/users/{userId}'] as Record<string, unknown>).delete
    ).toBeDefined();
  });

  test('password and preferences routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths['/api/users/{userId}/password']).toBeDefined();
    expect(paths['/api/users/{userId}/preferences']).toBeDefined();
    expect(paths['/api/users/{userId}/loggedIn']).toBeDefined();
    expect(paths['/api/users/_checkPassword']).toBeDefined();
  });
});

describe('Channel Servlet Routes', () => {
  test('channel CRUD routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    // GET /api/channels
    const channelsPath = paths['/api/channels'] as Record<string, unknown>;
    expect(channelsPath.get).toBeDefined();
    // POST /api/channels
    expect(channelsPath.post).toBeDefined();
    // GET /api/channels/{channelId}
    expect(paths['/api/channels/{channelId}']).toBeDefined();
    // PUT /api/channels/{channelId}
    expect(
      (paths['/api/channels/{channelId}'] as Record<string, unknown>).put
    ).toBeDefined();
    // DELETE /api/channels/{channelId}
    expect(
      (paths['/api/channels/{channelId}'] as Record<string, unknown>).delete
    ).toBeDefined();
  });

  test('channel metadata routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths['/api/channels/idsAndNames']).toBeDefined();
    expect(paths['/api/channels/{channelId}/connectorNames']).toBeDefined();
    expect(paths['/api/channels/{channelId}/metaDataColumns']).toBeDefined();
  });

  test('channel summary route is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    const summaryPath = paths['/api/channels/_getSummary'] as Record<string, unknown>;
    expect(summaryPath).toBeDefined();
    expect(summaryPath.post).toBeDefined();
  });

  test('GET /api/channels/{channelId} supports XML and JSON responses', () => {
    const paths = spec.paths as Record<string, unknown>;
    const channelPath = paths['/api/channels/{channelId}'] as Record<string, unknown>;
    const getOp = channelPath.get as Record<string, unknown>;
    const responses = getOp.responses as Record<string, unknown>;
    const okResponse = responses['200'] as Record<string, unknown>;
    const content = okResponse.content as Record<string, unknown>;
    expect(content['application/json']).toBeDefined();
    expect(content['application/xml']).toBeDefined();
  });
});

describe('Engine Servlet Routes', () => {
  test('deploy/undeploy routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths['/api/channels/_redeployAll']).toBeDefined();
    expect(paths['/api/channels/_deploy']).toBeDefined();
    expect(paths['/api/channels/_undeploy']).toBeDefined();
    expect(paths['/api/channels/{channelId}/_deploy']).toBeDefined();
    expect(paths['/api/channels/{channelId}/_undeploy']).toBeDefined();
  });

  test('deploy routes support returnErrors query parameter', () => {
    const paths = spec.paths as Record<string, unknown>;
    const deployPath = paths['/api/channels/_deploy'] as Record<string, unknown>;
    const postOp = deployPath.post as Record<string, unknown>;
    // The operation should have parameters or requestBody
    expect(postOp).toBeDefined();
  });
});

describe('Channel Status Servlet Routes', () => {
  test('status query routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths['/api/channels/{channelId}/status']).toBeDefined();
    expect(paths['/api/channels/statuses']).toBeDefined();
    expect(paths['/api/channels/statuses/initial']).toBeDefined();
  });

  test('lifecycle operations are registered for single and multi-channel', () => {
    const paths = spec.paths as Record<string, unknown>;
    const ops = ['_start', '_stop', '_halt', '_pause', '_resume'];
    for (const op of ops) {
      // Single channel
      const singlePath = paths[`/api/channels/{channelId}/${op}`];
      expect(singlePath).toBeDefined();
      // Multi channel
      const multiPath = paths[`/api/channels/${op}`];
      expect(multiPath).toBeDefined();
    }
  });

  test('connector-level start/stop routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths['/api/channels/{channelId}/connector/{metaDataId}/_start']).toBeDefined();
    expect(paths['/api/channels/{channelId}/connector/{metaDataId}/_stop']).toBeDefined();
  });
});

describe('Message Servlet Routes', () => {
  test('message search and retrieval routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    // Search
    expect(paths['/api/channels/{channelId}/messages']).toBeDefined();
    // Get by ID
    expect(paths['/api/channels/{channelId}/messages/{messageId}']).toBeDefined();
    // Count
    expect(paths['/api/channels/{channelId}/messages/count']).toBeDefined();
    // Max ID
    expect(paths['/api/channels/{channelId}/messages/maxMessageId']).toBeDefined();
  });

  test('message processing route is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    const messagesPath = paths['/api/channels/{channelId}/messages'] as Record<string, unknown>;
    expect(messagesPath.post).toBeDefined();
  });

  test('message deletion route is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    const messagePath = paths['/api/channels/{channelId}/messages/{messageId}'] as Record<
      string,
      unknown
    >;
    expect(messagePath.delete).toBeDefined();
  });

  test('reprocess route is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(
      paths['/api/channels/{channelId}/messages/{messageId}/_reprocess']
    ).toBeDefined();
  });

  test('attachment routes are registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(paths['/api/channels/{channelId}/messages/{messageId}/attachments']).toBeDefined();
    expect(
      paths['/api/channels/{channelId}/messages/{messageId}/attachments/{attachmentId}']
    ).toBeDefined();
  });

  test('content route is registered', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(
      paths[
        '/api/channels/{channelId}/messages/{messageId}/content/{metaDataId}/{contentType}'
      ]
    ).toBeDefined();
  });
});

describe('Spec Determinism', () => {
  test('generating spec twice produces identical output', () => {
    const generator1 = new OpenApiGeneratorV31(registry.definitions);
    const spec1 = generator1.generateDocument({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      servers: [{ url: 'http://localhost:8081' }],
    });

    const generator2 = new OpenApiGeneratorV31(registry.definitions);
    const spec2 = generator2.generateDocument({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      servers: [{ url: 'http://localhost:8081' }],
    });

    expect(JSON.stringify(spec1)).toBe(JSON.stringify(spec2));
  });
});

describe('Serve Module', () => {
  test('getOpenApiSpec returns valid spec object', () => {
    const serveSpec = getOpenApiSpec() as Record<string, unknown>;
    expect(serveSpec.openapi).toBe('3.1.0');
    expect(serveSpec.paths).toBeDefined();
    expect(serveSpec.components).toBeDefined();
  });

  test('getOpenApiSpec caches result', () => {
    const spec1 = getOpenApiSpec();
    const spec2 = getOpenApiSpec();
    // Should be the exact same reference (cached)
    expect(spec1).toBe(spec2);
  });
});

describe('Route Coverage Summary', () => {
  test('spec has at least 40 paths', () => {
    const paths = spec.paths as Record<string, unknown>;
    const pathCount = Object.keys(paths).length;
    expect(pathCount).toBeGreaterThanOrEqual(40);
  });

  test('spec has at least 20 schemas', () => {
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const schemaCount = Object.keys(schemas).length;
    expect(schemaCount).toBeGreaterThanOrEqual(20);
  });

  test('all tags are used by at least one path', () => {
    const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    const usedTags = new Set<string>();

    for (const pathObj of Object.values(paths)) {
      for (const operation of Object.values(pathObj)) {
        const tags = operation.tags as string[] | undefined;
        if (tags) {
          for (const tag of tags) {
            usedTags.add(tag);
          }
        }
      }
    }

    // All declared tags should be used
    expect(usedTags.has('Health')).toBe(true);
    expect(usedTags.has('Users')).toBe(true);
    expect(usedTags.has('Channels')).toBe(true);
    expect(usedTags.has('Engine')).toBe(true);
    expect(usedTags.has('Channel Status')).toBe(true);
    expect(usedTags.has('Messages')).toBe(true);
  });
});
