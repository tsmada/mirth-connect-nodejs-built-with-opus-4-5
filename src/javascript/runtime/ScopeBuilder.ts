/**
 * ScopeBuilder - Creates execution scopes for Mirth JavaScript scripts
 *
 * Ported from: com.mirth.connect.server.util.javascript.JavaScriptScopeUtil
 *
 * Purpose: Build scope objects with all required variables for different script contexts
 *
 * Key scope variables:
 * - msg, tmp: XML message objects
 * - $c, $s, $g, $gc, $cfg, $r, $co: Map shorthand variables
 * - logger, router, replacer: Utility objects
 * - channelId, channelName, connector: Context info
 */

import {
  MirthMap,
  SourceMap,
  ChannelMap,
  ResponseMap,
  GlobalMap,
  GlobalChannelMapStore,
  ConfigurationMap,
} from '../userutil/MirthMap.js';
import { XMLProxy, createXML, setDefaultXmlNamespace, getDefaultXmlNamespace } from '../e4x/XMLProxy.js';
import { transpileE4X } from '../e4x/E4XTranspiler.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Message } from '../../model/Message.js';
import { Status } from '../../model/Status.js';

// Module-level secrets function setter (same pattern as VMRouter)
let secretsFn: ((key: string) => string | undefined) | null = null;

export function setSecretsFunction(fn: (key: string) => string | undefined): void {
  secretsFn = fn;
}

/**
 * Logger interface for script execution
 */
export interface ScriptLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Default logger implementation
 */
export const defaultLogger: ScriptLogger = {
  debug: (msg: string) => console.debug(`[DEBUG] ${msg}`),
  info: (msg: string) => console.info(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

/**
 * Alert sender placeholder
 */
export class AlertSender {
  private channelId: string;

  constructor(channelId: string) {
    this.channelId = channelId;
  }

  sendAlert(message: string): void {
    console.warn(`[ALERT] Channel ${this.channelId}: ${message}`);
  }
}

/**
 * Router placeholder for message routing
 */
export class VMRouter {
  routeMessage(channelName: string, _message: string): void {
    console.info(`[ROUTER] Routing to ${channelName}`);
  }

  routeMessageByChannelId(channelId: string, _message: string): void {
    console.info(`[ROUTER] Routing to channel ${channelId}`);
  }
}

/**
 * Template value replacer placeholder
 */
export class TemplateValueReplacer {
  replaceValues(template: string, _map: MirthMap): string {
    return template;
  }
}

/**
 * Context for script execution
 */
export interface ScriptContext {
  channelId: string;
  channelName: string;
  connectorName?: string;
  metaDataId?: number;
  logger?: ScriptLogger;
}

/**
 * Scope object type
 */
export type Scope = Record<string, unknown>;

/**
 * Build the base scope with common utilities
 */
export function buildBasicScope(logger: ScriptLogger = defaultLogger): Scope {
  return {
    // Utilities
    logger,
    router: new VMRouter(),
    replacer: new TemplateValueReplacer(),

    // Global maps
    globalMap: GlobalMap.getInstance(),
    configurationMap: ConfigurationMap.getInstance(),

    // Shorthand for global maps
    $g: GlobalMap.getInstance(),
    $cfg: ConfigurationMap.getInstance(),

    // Secrets map (if secrets manager is initialized)
    ...(secretsFn ? { secretsMap: { get: secretsFn, containsKey: (k: string) => secretsFn!(k) !== undefined } } : {}),

    // XML utilities
    XMLProxy,
    XML: XMLProxy,
    createXML,
    setDefaultXmlNamespace,
    getDefaultXmlNamespace,

    // E4X transpiler (for dynamic script execution)
    transpileE4X,

    // Status enum values
    RECEIVED: Status.RECEIVED,
    FILTERED: Status.FILTERED,
    TRANSFORMED: Status.TRANSFORMED,
    SENT: Status.SENT,
    QUEUED: Status.QUEUED,
    ERROR: Status.ERROR,
    PENDING: Status.PENDING,

    // Console for debugging
    console,

    // Built-in functions that scripts might use
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Date,
    Math,
    JSON,
    RegExp,
    Error,
  };
}

/**
 * Build scope with channel context
 */
export function buildChannelScope(context: ScriptContext): Scope {
  const logger = context.logger ?? defaultLogger;
  const scope = buildBasicScope(logger);

  // Channel info
  scope.channelId = context.channelId;
  scope.channelName = context.channelName;

  // Global channel map
  const globalChannelMap = GlobalChannelMapStore.getInstance().get(context.channelId);
  scope.globalChannelMap = globalChannelMap;
  scope.$gc = globalChannelMap;

  // Alerts
  scope.alerts = new AlertSender(context.channelId);

  return scope;
}

/**
 * Build scope for connector message processing (filter/transformer)
 */
export function buildConnectorMessageScope(
  context: ScriptContext,
  connectorMessage: ConnectorMessage,
  rawContent?: string
): Scope {
  const scope = buildChannelScope(context);

  // Connector info
  scope.connectorMessage = connectorMessage;
  scope.connector = context.connectorName ?? connectorMessage.getConnectorName();

  // Source map (read-only)
  const sourceMap = new SourceMap(connectorMessage.getSourceMap());
  scope.sourceMap = sourceMap;
  scope.$s = sourceMap;

  // Channel map (with sourceMap fallback)
  const channelMap = new ChannelMap(connectorMessage.getChannelMap(), sourceMap);
  scope.channelMap = channelMap;
  scope.$c = channelMap;

  // Connector map
  const connectorMap = new MirthMap(connectorMessage.getConnectorMap());
  scope.connectorMap = connectorMap;
  scope.$co = connectorMap;

  // Response map
  const responseMap = new ResponseMap(connectorMessage.getResponseMap());
  scope.responseMap = responseMap;
  scope.$r = responseMap;

  // Message content
  if (rawContent) {
    scope.message = rawContent;
    // Create XML representation if it looks like XML
    if (rawContent.trim().startsWith('<')) {
      scope.msg = XMLProxy.create(rawContent);
    } else {
      scope.msg = rawContent;
    }
  }

  // Temporary message (starts as copy of msg)
  scope.tmp = scope.msg;

  return scope;
}

/**
 * Build scope for filter/transformer scripts
 */
export function buildFilterTransformerScope(
  context: ScriptContext,
  connectorMessage: ConnectorMessage,
  rawContent: string,
  template: string,
  phase: string
): Scope {
  const scope = buildConnectorMessageScope(context, connectorMessage, rawContent);

  // Template and phase
  scope.template = template;
  scope.phase = phase;

  return scope;
}

/**
 * Build scope for preprocessor scripts
 */
export function buildPreprocessorScope(
  context: ScriptContext,
  rawMessage: string,
  connectorMessage: ConnectorMessage
): Scope {
  const scope = buildConnectorMessageScope(context, connectorMessage, rawMessage);

  // Raw message is available as 'message'
  scope.message = rawMessage;

  return scope;
}

/**
 * Build scope for postprocessor scripts
 */
export function buildPostprocessorScope(
  context: ScriptContext,
  message: Message
): Scope {
  const scope = buildChannelScope(context);

  // Full message object
  scope.message = message;

  // Use source connector message for map access
  // In Java Mirth, there's getMergedConnectorMessage() but we use source as fallback
  const mergedConnectorMessage = message.getSourceConnectorMessage();
  if (mergedConnectorMessage) {
    const sourceMap = new SourceMap(mergedConnectorMessage.getSourceMap());
    scope.sourceMap = sourceMap;
    scope.$s = sourceMap;

    const channelMap = new ChannelMap(
      mergedConnectorMessage.getChannelMap(),
      sourceMap
    );
    scope.channelMap = channelMap;
    scope.$c = channelMap;

    const responseMap = new ResponseMap(mergedConnectorMessage.getResponseMap());
    scope.responseMap = responseMap;
    scope.$r = responseMap;
  }

  return scope;
}

/**
 * Build scope for response transformer scripts
 */
export function buildResponseTransformerScope(
  context: ScriptContext,
  connectorMessage: ConnectorMessage,
  response: { status: Status; statusMessage?: string; error?: string }
): Scope {
  const scope = buildConnectorMessageScope(context, connectorMessage);

  // Response data
  scope.response = response;
  scope.responseStatus = response.status;
  scope.responseStatusMessage = response.statusMessage ?? '';
  scope.responseErrorMessage = response.error ?? '';

  return scope;
}

/**
 * Build scope for deploy/undeploy scripts
 */
export function buildDeployScope(context: ScriptContext): Scope {
  return buildChannelScope(context);
}

/**
 * Sync maps back to connector message after script execution
 *
 * Note: Since ConnectorMessage maps are passed by reference to MirthMap,
 * modifications are automatically reflected. This function exists for
 * explicit sync operations or to copy from different map instances.
 */
export function syncMapsToConnectorMessage(
  scope: Scope,
  connectorMessage: ConnectorMessage
): void {
  // Sync channel map
  const channelMap = scope.channelMap as ChannelMap | undefined;
  if (channelMap) {
    const targetMap = connectorMessage.getChannelMap();
    for (const [key, value] of channelMap.getMap()) {
      targetMap.set(key, value);
    }
  }

  // Sync connector map
  const connectorMap = scope.connectorMap as MirthMap | undefined;
  if (connectorMap) {
    const targetMap = connectorMessage.getConnectorMap();
    for (const [key, value] of connectorMap.getMap()) {
      targetMap.set(key, value);
    }
  }

  // Sync response map
  const responseMap = scope.responseMap as ResponseMap | undefined;
  if (responseMap) {
    const targetMap = connectorMessage.getResponseMap();
    for (const [key, value] of responseMap.getMap()) {
      targetMap.set(key, value);
    }
  }
}

/**
 * ScopeBuilder class for fluent scope construction
 */
export class ScopeBuilder {
  private scope: Scope;
  private context: ScriptContext;

  constructor(context: ScriptContext) {
    this.context = context;
    this.scope = buildChannelScope(context);
  }

  /**
   * Add connector message context
   */
  withConnectorMessage(connectorMessage: ConnectorMessage, rawContent?: string): this {
    const connectorScope = buildConnectorMessageScope(
      this.context,
      connectorMessage,
      rawContent
    );
    this.scope = { ...this.scope, ...connectorScope };
    return this;
  }

  /**
   * Add filter/transformer context
   */
  withFilterTransformer(template: string, phase: string): this {
    this.scope.template = template;
    this.scope.phase = phase;
    return this;
  }

  /**
   * Add response context
   */
  withResponse(response: { status: Status; statusMessage?: string; error?: string }): this {
    this.scope.response = response;
    this.scope.responseStatus = response.status;
    this.scope.responseStatusMessage = response.statusMessage ?? '';
    this.scope.responseErrorMessage = response.error ?? '';
    return this;
  }

  /**
   * Add custom variable
   */
  withVariable(name: string, value: unknown): this {
    this.scope[name] = value;
    return this;
  }

  /**
   * Build the final scope
   */
  build(): Scope {
    return this.scope;
  }
}
