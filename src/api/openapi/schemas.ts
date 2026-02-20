/**
 * Zod schemas for OpenAPI 3.1 spec generation
 *
 * Each schema mirrors the corresponding TypeScript interface in src/api/models/
 * and is registered with OpenAPI metadata via .openapi().
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ============================================================================
// Common Schemas
// ============================================================================

export const ErrorSchema = z
  .object({
    error: z.string().openapi({ description: 'Error type or short message' }),
    message: z.string().optional().openapi({ description: 'Detailed error message' }),
  })
  .openapi('Error');

export const ChannelIdParam = z.string().uuid().openapi({
  description: 'Channel UUID',
  example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
});

// ============================================================================
// User Schemas
// ============================================================================

export const UserSchema = z
  .object({
    id: z.number().int().openapi({ description: 'User ID (auto-generated)' }),
    username: z.string().openapi({ description: 'Unique username' }),
    role: z
      .enum(['admin', 'manager', 'operator', 'monitor'])
      .optional()
      .openapi({ description: 'User role for RBAC' }),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    organization: z.string().optional(),
    email: z.string().email().optional(),
    phoneNumber: z.string().optional(),
    description: z.string().optional(),
    industry: z.string().optional(),
    lastLogin: z.string().datetime().optional().openapi({ description: 'ISO 8601 timestamp' }),
    gracePeriodStart: z.string().datetime().optional(),
    strikeCount: z.number().int().optional(),
  })
  .openapi('User');

export const CreateUserSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().optional().openapi({ description: 'Defaults to "admin" if omitted' }),
    role: z.enum(['admin', 'manager', 'operator', 'monitor']).optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    organization: z.string().optional(),
    email: z.string().email().optional(),
    phoneNumber: z.string().optional(),
    description: z.string().optional(),
    industry: z.string().optional(),
  })
  .openapi('CreateUser');

export const UpdateUserSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    organization: z.string().optional(),
    email: z.string().email().optional(),
    phoneNumber: z.string().optional(),
    description: z.string().optional(),
    industry: z.string().optional(),
    role: z.enum(['admin', 'manager', 'operator', 'monitor']).optional(),
  })
  .openapi('UpdateUser');

export const LoginRequestSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .openapi('LoginRequest');

export const LoginStatusSchema = z
  .object({
    status: z.enum([
      'SUCCESS',
      'SUCCESS_GRACE_PERIOD',
      'FAIL',
      'FAIL_LOCKED_OUT',
      'FAIL_EXPIRED',
    ]),
    message: z.string().optional(),
    updatedUsername: z.string().optional(),
  })
  .openapi('LoginStatus');

// ============================================================================
// Channel Schemas
// ============================================================================

export const FilterRuleSchema = z
  .object({
    name: z.string(),
    sequenceNumber: z.number().int(),
    enabled: z.boolean(),
    operator: z.enum(['AND', 'OR', 'NONE']),
    type: z.string(),
    script: z.string().optional(),
  })
  .openapi('FilterRule');

export const TransformerStepSchema = z
  .object({
    name: z.string(),
    sequenceNumber: z.number().int(),
    enabled: z.boolean(),
    type: z.string(),
    script: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('TransformerStep');

export const FilterConfigSchema = z
  .object({
    rules: z.array(FilterRuleSchema),
  })
  .openapi('FilterConfig');

export const TransformerConfigSchema = z
  .object({
    steps: z.array(TransformerStepSchema),
    inboundDataType: z.string().optional(),
    outboundDataType: z.string().optional(),
    inboundProperties: z.record(z.string(), z.unknown()).optional(),
    outboundProperties: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('TransformerConfig');

export const ConnectorSchema = z
  .object({
    metaDataId: z.number().int(),
    name: z.string(),
    enabled: z.boolean(),
    transportName: z.string().openapi({
      description: 'Transport type (e.g., HTTP Listener, Channel Writer, TCP Sender)',
    }),
    properties: z.record(z.string(), z.unknown()),
    filter: FilterConfigSchema.optional(),
    transformer: TransformerConfigSchema.optional(),
    responseTransformer: TransformerConfigSchema.optional(),
    waitForPrevious: z.boolean().optional(),
    queueEnabled: z.boolean().optional(),
  })
  .openapi('Connector');

export const MetaDataColumnConfigSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    mappingName: z.string(),
  })
  .openapi('MetaDataColumnConfig');

export const PruningSettingsSchema = z
  .object({
    pruneMetaDataDays: z.number().int().optional(),
    pruneContentDays: z.number().int().optional(),
    archiveEnabled: z.boolean().optional(),
    pruneErroredMessages: z.boolean().optional(),
  })
  .openapi('PruningSettings');

export const ChannelPropertiesSchema = z
  .object({
    clearGlobalChannelMap: z.boolean().optional(),
    messageStorageMode: z.string().optional(),
    encryptData: z.boolean().optional(),
    removeContentOnCompletion: z.boolean().optional(),
    removeOnlyFilteredOnCompletion: z.boolean().optional(),
    removeAttachmentsOnCompletion: z.boolean().optional(),
    initialState: z
      .enum([
        'DEPLOYING',
        'UNDEPLOYING',
        'STARTING',
        'STARTED',
        'PAUSING',
        'PAUSED',
        'STOPPING',
        'STOPPED',
        'SYNCING',
        'UNKNOWN',
      ])
      .optional(),
    storeAttachments: z.boolean().optional(),
    metaDataColumns: z.array(MetaDataColumnConfigSchema).optional(),
    attachmentProperties: z
      .object({ type: z.string(), properties: z.record(z.string(), z.unknown()).optional() })
      .optional(),
    resourceIds: z.record(z.string(), z.string()).optional(),
  })
  .openapi('ChannelProperties');

export const ChannelSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().optional(),
    revision: z.number().int(),
    enabled: z.boolean(),
    sourceConnector: ConnectorSchema,
    destinationConnectors: z.array(ConnectorSchema),
    preprocessingScript: z.string().optional(),
    postprocessingScript: z.string().optional(),
    deployScript: z.string().optional(),
    undeployScript: z.string().optional(),
    properties: ChannelPropertiesSchema,
  })
  .openapi('Channel');

export const ChannelSummarySchema = z
  .object({
    channelId: z.string().uuid(),
    channel: ChannelSchema.optional(),
    deleted: z.boolean().optional(),
    undeployed: z.boolean().optional(),
  })
  .openapi('ChannelSummary');

// ============================================================================
// Dashboard / Channel Status Schemas
// ============================================================================

export const ChannelStatisticsSchema = z
  .object({
    received: z.number().int(),
    sent: z.number().int(),
    error: z.number().int(),
    filtered: z.number().int(),
    queued: z.number().int(),
  })
  .openapi('ChannelStatistics');

export const DeployedStateEnum = z.enum([
  'DEPLOYING',
  'UNDEPLOYING',
  'STARTING',
  'STARTED',
  'PAUSING',
  'PAUSED',
  'STOPPING',
  'STOPPED',
  'SYNCING',
  'UNKNOWN',
]);

export const DashboardStatusSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      channelId: z.string().uuid(),
      name: z.string(),
      state: DeployedStateEnum,
      deployedRevisionDelta: z.number().int().optional(),
      deployedDate: z.string().datetime().optional(),
      statistics: ChannelStatisticsSchema,
      childStatuses: z.array(z.lazy(() => DashboardStatusSchema)).optional(),
      metaDataId: z.number().int().optional(),
      queueEnabled: z.boolean().optional(),
      queued: z.number().int().optional(),
      waitForPrevious: z.boolean().optional(),
    })
    .openapi('DashboardStatus')
);

export const DashboardChannelInfoSchema = z
  .object({
    dashboardStatuses: z.array(DashboardStatusSchema),
    remainingChannelIds: z.array(z.string().uuid()),
  })
  .openapi('DashboardChannelInfo');

// ============================================================================
// Message Schemas
// ============================================================================

export const MessageStatusEnum = z.enum(['R', 'F', 'T', 'S', 'Q', 'E', 'P']).openapi({
  description: 'R=RECEIVED, F=FILTERED, T=TRANSFORMED, S=SENT, Q=QUEUED, E=ERROR, P=PENDING',
});

export const MessageContentSchema = z
  .object({
    contentType: z.number().int().min(1).max(15),
    content: z.string(),
    dataType: z.string(),
    encrypted: z.boolean(),
  })
  .openapi('MessageContent');

export const ConnectorMessageSchema = z
  .object({
    messageId: z.number().int(),
    metaDataId: z.number().int(),
    channelId: z.string().uuid(),
    channelName: z.string().optional(),
    connectorName: z.string(),
    receivedDate: z.string().datetime(),
    status: MessageStatusEnum,
    sendAttempts: z.number().int(),
    sendDate: z.string().datetime().optional(),
    responseDate: z.string().datetime().optional(),
    errorCode: z.number().int().optional(),
    content: z.record(z.coerce.number(), MessageContentSchema).optional(),
  })
  .openapi('ConnectorMessage');

export const MessageSchema = z
  .object({
    messageId: z.number().int(),
    channelId: z.string().uuid(),
    serverId: z.string(),
    receivedDate: z.string().datetime(),
    processed: z.boolean(),
    originalId: z.number().int().optional(),
    importId: z.number().int().optional(),
    connectorMessages: z.record(z.coerce.number(), ConnectorMessageSchema),
  })
  .openapi('Message');

export const MessageFilterSchema = z
  .object({
    maxMessageId: z.number().int().optional(),
    minMessageId: z.number().int().optional(),
    originalIdUpper: z.number().int().optional(),
    originalIdLower: z.number().int().optional(),
    importIdUpper: z.number().int().optional(),
    importIdLower: z.number().int().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    textSearch: z.string().optional(),
    textSearchRegex: z.boolean().optional(),
    statuses: z.array(MessageStatusEnum).optional(),
    includedMetaDataIds: z.array(z.number().int()).optional(),
    excludedMetaDataIds: z.array(z.number().int()).optional(),
    serverId: z.string().optional(),
    attachment: z.boolean().optional(),
    error: z.boolean().optional(),
  })
  .openapi('MessageFilter');

// ============================================================================
// Event Schemas
// ============================================================================

export const EventLevelEnum = z.enum(['INFORMATION', 'WARNING', 'ERROR']);
export const EventOutcomeEnum = z.enum(['SUCCESS', 'FAILURE']);

export const ServerEventSchema = z
  .object({
    id: z.number().int(),
    eventTime: z.string().datetime(),
    level: EventLevelEnum,
    name: z.string(),
    attributes: z.record(z.string(), z.string()),
    outcome: EventOutcomeEnum,
    userId: z.number().int(),
    ipAddress: z.string().nullable(),
    serverId: z.string(),
  })
  .openapi('ServerEvent');

export const EventFilterSchema = z
  .object({
    maxEventId: z.number().int().optional(),
    minEventId: z.number().int().optional(),
    id: z.number().int().optional(),
    levels: z.array(EventLevelEnum).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    name: z.string().optional(),
    outcome: EventOutcomeEnum.optional(),
    userId: z.number().int().optional(),
    ipAddress: z.string().optional(),
    serverId: z.string().optional(),
  })
  .openapi('EventFilter');

// ============================================================================
// Alert Schemas
// ============================================================================

export const AlertActionSchema = z
  .object({
    protocol: z.string(),
    recipient: z.string(),
  })
  .openapi('AlertAction');

export const AlertActionGroupSchema = z
  .object({
    actions: z.array(AlertActionSchema),
    subject: z.string().optional(),
    template: z.string().optional(),
  })
  .openapi('AlertActionGroup');

export const AlertModelSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    enabled: z.boolean(),
    trigger: z.object({ name: z.string() }).passthrough(),
    actionGroups: z.array(AlertActionGroupSchema),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('AlertModel');

export const AlertStatusSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    enabled: z.boolean(),
    alertedCount: z.number().int(),
  })
  .openapi('AlertStatus');

// ============================================================================
// Server Settings Schemas
// ============================================================================

export const ServerSettingsSchema = z
  .object({
    environmentName: z.string().optional(),
    serverName: z.string().optional(),
    clearGlobalMap: z.boolean().optional(),
    queueBufferSize: z.number().int().optional(),
    smtpHost: z.string().optional(),
    smtpPort: z.string().optional(),
    smtpTimeout: z.number().int().optional(),
    smtpFrom: z.string().optional(),
    smtpSecure: z.string().optional(),
    smtpAuth: z.boolean().optional(),
    smtpUsername: z.string().optional(),
    smtpPassword: z.string().optional(),
  })
  .openapi('ServerSettings');

export const PasswordRequirementsSchema = z
  .object({
    minLength: z.number().int().optional(),
    minUpper: z.number().int().optional(),
    minLower: z.number().int().optional(),
    minNumeric: z.number().int().optional(),
    minSpecial: z.number().int().optional(),
    retryLimit: z.number().int().optional(),
    lockoutPeriod: z.number().int().optional(),
    expiration: z.number().int().optional(),
    gracePeriod: z.number().int().optional(),
    reusePeriod: z.number().int().optional(),
    reuseLimit: z.number().int().optional(),
  })
  .openapi('PasswordRequirements');

export const ChannelTagSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    channelIds: z.array(z.string().uuid()),
    backgroundColor: z.string().optional(),
  })
  .openapi('ChannelTag');

export const ChannelDependencySchema = z
  .object({
    dependentId: z.string().uuid(),
    dependencyId: z.string().uuid(),
  })
  .openapi('ChannelDependency');

// ============================================================================
// Health Check Schema
// ============================================================================

export const HealthCheckSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'error']),
    uptime: z.number().optional(),
    version: z.string().optional(),
    shadowMode: z.boolean().optional(),
    clusterEnabled: z.boolean().optional(),
  })
  .openapi('HealthCheck');
