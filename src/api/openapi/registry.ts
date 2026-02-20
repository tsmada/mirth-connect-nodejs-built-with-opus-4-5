/**
 * OpenAPI Route Registry
 *
 * Registers API routes with Zod schemas for OpenAPI 3.1 spec generation.
 * Covers the 5 highest-traffic servlets: Channel, User, Message, Engine, ChannelStatus.
 *
 * Each registration maps an HTTP method + path to request/response schemas,
 * enabling automated spec generation via @asteasolutions/zod-to-openapi.
 */

import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ErrorSchema,
  ChannelIdParam,
  UserSchema,
  CreateUserSchema,
  UpdateUserSchema,
  LoginRequestSchema,
  LoginStatusSchema,
  ChannelSchema,
  ChannelSummarySchema,
  MetaDataColumnConfigSchema,
  DashboardStatusSchema,
  DashboardChannelInfoSchema,
  MessageSchema,
  MessageContentSchema,
  HealthCheckSchema,
} from './schemas.js';

export const registry = new OpenAPIRegistry();

// ============================================================================
// Security Schemes
// ============================================================================

registry.registerComponent('securitySchemes', 'sessionCookie', {
  type: 'apiKey',
  in: 'cookie',
  name: 'JSESSIONID',
  description: 'Session cookie set after login via POST /api/users/_login',
});

registry.registerComponent('securitySchemes', 'sessionHeader', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Session-ID',
  description: 'Alternative session ID passed as header',
});

const security: Record<string, string[]>[] = [{ sessionCookie: [] }, { sessionHeader: [] }];

// ============================================================================
// Health Check (No Auth)
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/health',
  summary: 'Readiness probe',
  description: 'Returns 200 when ready to accept traffic, 503 during shutdown. No auth required.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Service is ready',
      content: { 'application/json': { schema: HealthCheckSchema } },
    },
    503: { description: 'Service is shutting down' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/health/live',
  summary: 'Liveness probe',
  description: 'Always returns 200. Used by orchestrators to detect crashed processes.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Service is alive',
      content: { 'application/json': { schema: HealthCheckSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/health/startup',
  summary: 'Startup probe',
  description: 'Returns 200 after channels are deployed. Used by orchestrators for slow-start.',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Service has started',
      content: { 'application/json': { schema: HealthCheckSchema } },
    },
    503: { description: 'Service is still starting' },
  },
});

// ============================================================================
// User Servlet — /api/users
// ============================================================================

registry.registerPath({
  method: 'post',
  path: '/api/users/_login',
  summary: 'Login',
  description: 'Authenticate with username and password. Returns session cookie.',
  tags: ['Users'],
  request: {
    body: {
      content: { 'application/json': { schema: LoginRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Login result (check status field for SUCCESS/FAIL)',
      content: { 'application/json': { schema: LoginStatusSchema } },
    },
    401: {
      description: 'Invalid credentials or locked account',
      content: { 'application/json': { schema: LoginStatusSchema } },
    },
    429: {
      description: 'Too many login attempts',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/users/_logout',
  summary: 'Logout',
  description: 'Destroy current session and clear session cookie.',
  tags: ['Users'],
  security,
  responses: {
    204: { description: 'Logged out successfully' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/users',
  summary: 'Get all users',
  tags: ['Users'],
  security,
  responses: {
    200: {
      description: 'User list',
      content: { 'application/json': { schema: z.array(UserSchema) } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Insufficient permissions',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/users/current',
  summary: 'Get current user',
  description: 'Returns the currently authenticated user.',
  tags: ['Users'],
  security,
  responses: {
    200: {
      description: 'Current user',
      content: { 'application/json': { schema: UserSchema } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/users/{userIdOrName}',
  summary: 'Get user by ID or username',
  tags: ['Users'],
  security,
  request: {
    params: z.object({
      userIdOrName: z.string().openapi({ description: 'User ID (integer) or username (string)' }),
    }),
  },
  responses: {
    200: {
      description: 'User details',
      content: { 'application/json': { schema: UserSchema } },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/users',
  summary: 'Create user',
  tags: ['Users'],
  security,
  request: {
    body: {
      content: { 'application/json': { schema: CreateUserSchema } },
      required: true,
    },
  },
  responses: {
    201: { description: 'User created' },
    400: {
      description: 'Username is required',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'User already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/users/{userId}',
  summary: 'Update user',
  tags: ['Users'],
  security,
  request: {
    params: z.object({
      userId: z.string().openapi({ description: 'User ID' }),
    }),
    body: {
      content: { 'application/json': { schema: UpdateUserSchema } },
      required: true,
    },
  },
  responses: {
    204: { description: 'User updated' },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/users/{userId}',
  summary: 'Delete user',
  tags: ['Users'],
  security,
  request: {
    params: z.object({
      userId: z.string().openapi({ description: 'User ID' }),
    }),
  },
  responses: {
    204: { description: 'User deleted' },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/users/{userId}/password',
  summary: 'Update user password',
  tags: ['Users'],
  security,
  request: {
    params: z.object({
      userId: z.string().openapi({ description: 'User ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ password: z.string().min(1) }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Empty array if valid, or array of requirement violations',
      content: { 'application/json': { schema: z.array(z.string()) } },
    },
    400: {
      description: 'Password requirements not met',
      content: { 'application/json': { schema: z.array(z.string()) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/users/{userId}/loggedIn',
  summary: 'Check if user is logged in',
  tags: ['Users'],
  security,
  request: {
    params: z.object({
      userId: z.string().openapi({ description: 'User ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Login status',
      content: { 'application/json': { schema: z.boolean() } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/users/_checkPassword',
  summary: 'Check password against requirements',
  tags: ['Users'],
  security,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ password: z.string() }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Array of requirement violations (empty if valid)',
      content: { 'application/json': { schema: z.array(z.string()) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/users/{userId}/preferences',
  summary: 'Get user preferences',
  tags: ['Users'],
  security,
  request: {
    params: z.object({ userId: z.string() }),
    query: z.object({ name: z.string().optional() }),
  },
  responses: {
    200: {
      description: 'Preference map',
      content: { 'application/json': { schema: z.record(z.string(), z.string()) } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/users/{userId}/preferences',
  summary: 'Update user preferences',
  tags: ['Users'],
  security,
  request: {
    params: z.object({ userId: z.string() }),
    body: {
      content: { 'application/json': { schema: z.record(z.string(), z.string()) } },
      required: true,
    },
  },
  responses: {
    204: { description: 'Preferences updated' },
  },
});

// ============================================================================
// Channel Servlet — /api/channels
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/channels',
  summary: 'Get channels',
  description: 'Get all channels or filter by IDs.',
  tags: ['Channels'],
  security,
  request: {
    query: z.object({
      channelId: z.union([z.string(), z.array(z.string())]).optional().openapi({
        description: 'Filter by channel ID(s)',
      }),
      pollingOnly: z.string().optional().openapi({ description: 'Only return polling channels' }),
      includeCodeTemplateLibraries: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Channel list',
      content: { 'application/json': { schema: z.array(ChannelSchema) } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/_getChannels',
  summary: 'Get channels by IDs (POST)',
  description: 'POST alternative for large ID sets.',
  tags: ['Channels'],
  security,
  request: {
    body: {
      content: { 'application/json': { schema: z.array(z.string().uuid()) } },
    },
    query: z.object({
      pollingOnly: z.string().optional(),
      includeCodeTemplateLibraries: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Channel list',
      content: { 'application/json': { schema: z.array(ChannelSchema) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/idsAndNames',
  summary: 'Get channel ID-to-name map',
  tags: ['Channels'],
  security,
  responses: {
    200: {
      description: 'Map of channel UUIDs to channel names',
      content: { 'application/json': { schema: z.record(z.string(), z.string()) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}',
  summary: 'Get channel by ID',
  tags: ['Channels'],
  security,
  request: {
    params: z.object({ channelId: ChannelIdParam }),
    query: z.object({
      includeCodeTemplateLibraries: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Channel details',
      content: {
        'application/json': { schema: ChannelSchema },
        'application/xml': { schema: z.string().openapi({ description: 'Raw channel XML' }) },
      },
    },
    404: {
      description: 'Channel not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/_getSummary',
  summary: 'Get channel summaries',
  tags: ['Channels'],
  security,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.record(z.string(), z.object({ revision: z.number().int() })).openapi({
            description: 'Map of channelId → { revision } for cached channels',
          }),
        },
      },
    },
    query: z.object({
      ignoreNewChannels: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Channel summaries',
      content: { 'application/json': { schema: z.array(ChannelSummarySchema) } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels',
  summary: 'Create channel',
  tags: ['Channels'],
  security,
  request: {
    body: {
      content: {
        'application/json': { schema: ChannelSchema },
        'application/xml': { schema: z.string() },
      },
      required: true,
    },
    query: z.object({
      override: z.string().optional().openapi({ description: 'Update if exists' }),
    }),
  },
  responses: {
    201: {
      description: 'Channel created',
      content: { 'application/json': { schema: z.boolean() } },
    },
    400: {
      description: 'Channel name is required',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Channel already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/channels/{channelId}',
  summary: 'Update channel',
  tags: ['Channels'],
  security,
  request: {
    params: z.object({ channelId: ChannelIdParam }),
    body: {
      content: { 'application/json': { schema: ChannelSchema } },
      required: true,
    },
    query: z.object({
      override: z.string().optional().openapi({ description: 'Skip revision check' }),
    }),
  },
  responses: {
    200: {
      description: 'Update result',
      content: { 'application/json': { schema: z.boolean() } },
    },
    404: {
      description: 'Channel not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Channel has been modified (revision mismatch)',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/channels/{channelId}',
  summary: 'Delete channel',
  tags: ['Channels'],
  security,
  request: {
    params: z.object({ channelId: ChannelIdParam }),
  },
  responses: {
    204: { description: 'Channel deleted' },
    404: {
      description: 'Channel not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/connectorNames',
  summary: 'Get connector names',
  tags: ['Channels'],
  security,
  request: {
    params: z.object({ channelId: ChannelIdParam }),
  },
  responses: {
    200: {
      description: 'Map of metaDataId to connector name',
      content: { 'application/json': { schema: z.record(z.string(), z.string()) } },
    },
    404: {
      description: 'Channel not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/metaDataColumns',
  summary: 'Get metadata columns',
  tags: ['Channels'],
  security,
  request: {
    params: z.object({ channelId: ChannelIdParam }),
  },
  responses: {
    200: {
      description: 'Metadata column definitions',
      content: {
        'application/json': { schema: z.array(MetaDataColumnConfigSchema) },
      },
    },
  },
});

// ============================================================================
// Engine Servlet — /api/channels (deploy/undeploy operations)
// ============================================================================

registry.registerPath({
  method: 'post',
  path: '/api/channels/_redeployAll',
  summary: 'Redeploy all channels',
  tags: ['Engine'],
  security,
  request: {
    query: z.object({
      returnErrors: z.string().optional().openapi({
        description: 'Return errors instead of 204 on failure',
      }),
    }),
  },
  responses: {
    204: { description: 'All channels redeployed' },
    500: {
      description: 'Deployment error (only when returnErrors=true)',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/{channelId}/_deploy',
  summary: 'Deploy a channel',
  tags: ['Engine'],
  security,
  request: {
    params: z.object({ channelId: ChannelIdParam }),
    query: z.object({ returnErrors: z.string().optional() }),
  },
  responses: {
    204: { description: 'Channel deployed' },
    500: {
      description: 'Deployment error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/_deploy',
  summary: 'Deploy multiple channels',
  description: 'Deploy channels by ID list. Accepts JSON array or XML set format.',
  tags: ['Engine'],
  security,
  request: {
    body: {
      content: {
        'application/json': { schema: z.array(z.string().uuid()) },
      },
    },
    query: z.object({ returnErrors: z.string().optional() }),
  },
  responses: {
    204: { description: 'Channels deployed' },
    500: {
      description: 'Deployment errors',
      content: {
        'application/json': {
          schema: z.object({
            errors: z.array(z.object({ channelId: z.string(), error: z.string() })),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/{channelId}/_undeploy',
  summary: 'Undeploy a channel',
  tags: ['Engine'],
  security,
  request: {
    params: z.object({ channelId: ChannelIdParam }),
    query: z.object({ returnErrors: z.string().optional() }),
  },
  responses: {
    204: { description: 'Channel undeployed' },
    500: {
      description: 'Undeployment error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/_undeploy',
  summary: 'Undeploy multiple channels',
  tags: ['Engine'],
  security,
  request: {
    body: {
      content: { 'application/json': { schema: z.array(z.string().uuid()) } },
    },
    query: z.object({ returnErrors: z.string().optional() }),
  },
  responses: {
    204: { description: 'Channels undeployed' },
  },
});

// ============================================================================
// Channel Status Servlet — /api/channels (status operations)
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/status',
  summary: 'Get channel status',
  tags: ['Channel Status'],
  security,
  request: {
    params: z.object({ channelId: ChannelIdParam }),
  },
  responses: {
    200: {
      description: 'Channel dashboard status',
      content: { 'application/json': { schema: DashboardStatusSchema } },
    },
    404: {
      description: 'Channel not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/statuses',
  summary: 'Get all channel statuses',
  tags: ['Channel Status'],
  security,
  request: {
    query: z.object({
      channelId: z.union([z.string(), z.array(z.string())]).optional(),
      filter: z.string().optional(),
      includeUndeployed: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Dashboard status list',
      content: { 'application/json': { schema: z.array(DashboardStatusSchema) } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/statuses/initial',
  summary: 'Get initial dashboard channel info',
  tags: ['Channel Status'],
  security,
  request: {
    query: z.object({
      fetchSize: z.string().optional().openapi({ description: 'Number of channels to fetch (default 100)' }),
      filter: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Dashboard channel info with remaining channel IDs',
      content: { 'application/json': { schema: DashboardChannelInfoSchema } },
    },
  },
});

// Channel lifecycle operations (start/stop/pause/resume/halt)
const channelLifecycleOps = [
  { action: '_start', summary: 'Start', tag: 'Channel Status' },
  { action: '_stop', summary: 'Stop', tag: 'Channel Status' },
  { action: '_halt', summary: 'Halt (force stop)', tag: 'Channel Status' },
  { action: '_pause', summary: 'Pause', tag: 'Channel Status' },
  { action: '_resume', summary: 'Resume', tag: 'Channel Status' },
] as const;

for (const op of channelLifecycleOps) {
  // Single channel
  registry.registerPath({
    method: 'post',
    path: `/api/channels/{channelId}/${op.action}`,
    summary: `${op.summary} a channel`,
    tags: [op.tag],
    security,
    request: {
      params: z.object({ channelId: ChannelIdParam }),
      query: z.object({ returnErrors: z.string().optional() }),
    },
    responses: {
      204: { description: `Channel ${op.summary.toLowerCase()}ed` },
      500: {
        description: 'Operation error',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  // Multiple channels
  registry.registerPath({
    method: 'post',
    path: `/api/channels/${op.action}`,
    summary: `${op.summary} multiple channels`,
    tags: [op.tag],
    security,
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              channelId: z.union([z.string(), z.array(z.string())]).optional(),
            }),
          },
        },
      },
      query: z.object({ returnErrors: z.string().optional() }),
    },
    responses: {
      204: { description: `Channels ${op.summary.toLowerCase()}ed` },
    },
  });
}

// Connector-level start/stop
registry.registerPath({
  method: 'post',
  path: '/api/channels/{channelId}/connector/{metaDataId}/_start',
  summary: 'Start a connector',
  tags: ['Channel Status'],
  security,
  request: {
    params: z.object({
      channelId: ChannelIdParam,
      metaDataId: z.string().openapi({ description: 'Connector metadata ID' }),
    }),
    query: z.object({ returnErrors: z.string().optional() }),
  },
  responses: {
    204: { description: 'Connector started' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/{channelId}/connector/{metaDataId}/_stop',
  summary: 'Stop a connector',
  tags: ['Channel Status'],
  security,
  request: {
    params: z.object({
      channelId: ChannelIdParam,
      metaDataId: z.string().openapi({ description: 'Connector metadata ID' }),
    }),
    query: z.object({ returnErrors: z.string().optional() }),
  },
  responses: {
    204: { description: 'Connector stopped' },
  },
});

// ============================================================================
// Message Servlet — /api/channels/{channelId}/messages
// ============================================================================

const channelIdInPath = z.object({ channelId: ChannelIdParam });

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/messages',
  summary: 'Search messages',
  description: 'Search messages with filter criteria. Query parameters map to MessageFilter fields.',
  tags: ['Messages'],
  security,
  request: {
    params: channelIdInPath,
    query: z.object({
      minMessageId: z.string().optional(),
      maxMessageId: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      textSearch: z.string().optional(),
      textSearchRegex: z.string().optional(),
      statuses: z.union([z.string(), z.array(z.string())]).optional().openapi({
        description: 'Filter by status (R, F, T, S, Q, E, P)',
      }),
      includedMetaDataIds: z.union([z.string(), z.array(z.string())]).optional(),
      offset: z.string().optional(),
      limit: z.string().optional().openapi({ description: 'Page size (default 20)' }),
      includeContent: z.string().optional(),
      attachment: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated message list',
      content: {
        'application/json': {
          schema: z.object({
            messages: z.array(MessageSchema),
            total: z.number().int(),
            offset: z.number().int(),
            limit: z.number().int(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/messages/{messageId}',
  summary: 'Get message by ID',
  tags: ['Messages'],
  security,
  request: {
    params: z.object({
      channelId: ChannelIdParam,
      messageId: z.string().openapi({ description: 'Message ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Message details',
      content: { 'application/json': { schema: MessageSchema } },
    },
    404: {
      description: 'Message not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/messages/count',
  summary: 'Get message count',
  tags: ['Messages'],
  security,
  request: {
    params: channelIdInPath,
    query: z.object({
      minMessageId: z.string().optional(),
      maxMessageId: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      textSearch: z.string().optional(),
      statuses: z.union([z.string(), z.array(z.string())]).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Message count',
      content: { 'application/json': { schema: z.number().int() } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/messages/maxMessageId',
  summary: 'Get max message ID',
  tags: ['Messages'],
  security,
  request: { params: channelIdInPath },
  responses: {
    200: {
      description: 'Maximum message ID',
      content: { 'application/json': { schema: z.number().int() } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/{channelId}/messages',
  summary: 'Process a new message',
  description: 'Submit a raw message for processing by the channel.',
  tags: ['Messages'],
  security,
  request: {
    params: channelIdInPath,
    body: {
      content: {
        'text/plain': { schema: z.string().openapi({ description: 'Raw message content' }) },
        'application/json': { schema: z.object({ rawData: z.string() }).passthrough() },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Message ID of processed message',
      content: { 'application/json': { schema: z.number().int() } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/channels/{channelId}/messages/{messageId}',
  summary: 'Delete a message',
  tags: ['Messages'],
  security,
  request: {
    params: z.object({
      channelId: ChannelIdParam,
      messageId: z.string(),
    }),
  },
  responses: {
    204: { description: 'Message deleted' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/channels/{channelId}/messages/{messageId}/_reprocess',
  summary: 'Reprocess a message',
  tags: ['Messages'],
  security,
  request: {
    params: z.object({
      channelId: ChannelIdParam,
      messageId: z.string(),
    }),
    query: z.object({
      replace: z.string().optional().openapi({ description: 'Replace original message' }),
      filterDestinations: z.string().optional(),
      metaDataId: z.union([z.string(), z.array(z.string())]).optional(),
    }),
  },
  responses: {
    204: { description: 'Message reprocessed' },
  },
});

// Message content operations
registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/messages/{messageId}/content/{metaDataId}/{contentType}',
  summary: 'Get message content',
  tags: ['Messages'],
  security,
  request: {
    params: z.object({
      channelId: ChannelIdParam,
      messageId: z.string(),
      metaDataId: z.string(),
      contentType: z.string().openapi({ description: 'Content type number (1-15)' }),
    }),
  },
  responses: {
    200: {
      description: 'Message content',
      content: { 'application/json': { schema: MessageContentSchema } },
    },
    404: {
      description: 'Content not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

// Attachment operations
registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/messages/{messageId}/attachments',
  summary: 'Get message attachments',
  tags: ['Messages'],
  security,
  request: {
    params: z.object({
      channelId: ChannelIdParam,
      messageId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Attachment list',
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              id: z.string(),
              type: z.string().optional(),
              size: z.number().int().optional(),
            })
          ),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/channels/{channelId}/messages/{messageId}/attachments/{attachmentId}',
  summary: 'Get attachment content',
  tags: ['Messages'],
  security,
  request: {
    params: z.object({
      channelId: ChannelIdParam,
      messageId: z.string(),
      attachmentId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Attachment content',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            content: z.string(),
            type: z.string().optional(),
          }),
        },
      },
    },
    404: {
      description: 'Attachment not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});
