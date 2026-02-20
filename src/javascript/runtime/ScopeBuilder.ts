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
import {
  XMLProxy,
  createXML,
  setDefaultXmlNamespace,
  getDefaultXmlNamespace,
} from '../e4x/XMLProxy.js';
import { transpileE4X } from '../e4x/E4XTranspiler.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Message } from '../../model/Message.js';
import { Status } from '../../model/Status.js';

// Real userutil implementations (replace placeholders)
import { VMRouter as RealVMRouter } from '../userutil/VMRouter.js';
import { AlertSender as RealAlertSender } from '../userutil/AlertSender.js';
import { ValueReplacer } from '../../util/ValueReplacer.js';
import { SerializerFactory } from '../../util/SerializerFactory.js';

/**
 * Stub VMRouter used when controllers aren't initialized yet (tests, early startup).
 * Falls back to the real VMRouter once controllers are wired via setChannelController/setEngineController.
 */
class StubVMRouter {
  routeMessage(_channelName: string, _message: string): void {
    console.warn('[ROUTER] VMRouter not initialized - controllers not set');
  }
  routeMessageByChannelId(_channelId: string, _message: string): void {
    console.warn('[ROUTER] VMRouter not initialized - controllers not set');
  }
}

/**
 * Create VMRouter, falling back to stub if controllers aren't initialized
 */
function createVMRouter(): RealVMRouter | StubVMRouter {
  try {
    return new RealVMRouter();
  } catch {
    return new StubVMRouter();
  }
}

// Userutil classes (Java: importPackage)
import { DatabaseConnectionFactory } from '../userutil/DatabaseConnectionFactory.js';
import { DatabaseConnection } from '../userutil/DatabaseConnection.js';
import { ContextFactory } from '../userutil/ContextFactory.js';
import { FileUtil } from '../userutil/FileUtil.js';
import { HTTPUtil } from '../userutil/HTTPUtil.js';
import { DateUtil } from '../userutil/DateUtil.js';
import { SMTPConnectionFactory } from '../userutil/SMTPConnectionFactory.js';
import { SMTPConnection } from '../userutil/SMTPConnection.js';
import { UUIDGenerator } from '../userutil/UUIDGenerator.js';
import { RawMessage } from '../userutil/RawMessage.js';
import { ResponseFactory } from '../userutil/ResponseFactory.js';
import { ImmutableResponse } from '../userutil/ImmutableResponse.js';
import { NCPDPUtil } from '../userutil/NCPDPUtil.js';
import { DICOMUtil } from '../userutil/DICOMUtil.js';
import { AttachmentUtil } from '../userutil/AttachmentUtil.js';
import { ChannelUtil } from '../userutil/ChannelUtil.js';
import { Attachment } from '../userutil/Attachment.js';
import { DestinationSet } from '../userutil/DestinationSet.js';
import { MirthCachedRowSet } from '../userutil/MirthCachedRowSet.js';
import { Future } from '../userutil/Future.js';

// Wave 8 userutil classes (Java: com.mirth.connect.userutil)
import { XmlUtil } from '../userutil/XmlUtil.js';
import { JsonUtil } from '../userutil/JsonUtil.js';
import { Lists, ListBuilder } from '../userutil/Lists.js';
import { Maps, MapBuilder } from '../userutil/Maps.js';

// HTTP header/parameter wrappers (Java: com.mirth.connect.userutil)
import { MessageHeaders } from '../userutil/MessageHeaders.js';
import { MessageParameters } from '../userutil/MessageParameters.js';

// ACK generation (Java: com.mirth.connect.server.userutil.ACKGenerator)
import { ACKGenerator } from '../../util/ACKGenerator.js';

// XSLT transformer for XsltStep plugin (Java: javax.xml.transform)
import { XsltTransformer } from '../../plugins/xsltstep/XsltStep.js';

// Response class (Java: com.mirth.connect.userutil.Response)
import { Response } from '../../model/Response.js';

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
    router: createVMRouter(),
    replacer: new ValueReplacer(),

    // Global maps
    globalMap: GlobalMap.getInstance(),
    configurationMap: ConfigurationMap.getInstance(),

    // Shorthand for global maps
    $g: GlobalMap.getInstance(),
    $cfg: ConfigurationMap.getInstance(),

    // Secrets map (if secrets manager is initialized)
    ...(secretsFn
      ? { secretsMap: { get: secretsFn, containsKey: (k: string) => secretsFn!(k) !== undefined } }
      : {}),

    // XML utilities
    XMLProxy,
    XML: XMLProxy,
    createXML,
    setDefaultXmlNamespace,
    getDefaultXmlNamespace,

    // E4X transpiler (for dynamic script execution)
    transpileE4X,

    // Status enum — both as object and individual values (Java exposes both patterns)
    Status,
    RECEIVED: Status.RECEIVED,
    FILTERED: Status.FILTERED,
    TRANSFORMED: Status.TRANSFORMED,
    SENT: Status.SENT,
    QUEUED: Status.QUEUED,
    ERROR: Status.ERROR,
    PENDING: Status.PENDING,

    // Response class (Java: com.mirth.connect.userutil.Response)
    Response,

    // ACK generator (Java: com.mirth.connect.server.userutil.ACKGenerator)
    ACKGenerator,

    // Userutil classes (Java: importPackage(Packages.com.mirth.connect.server.userutil))
    DatabaseConnectionFactory,
    DatabaseConnection,
    ContextFactory,
    FileUtil,
    HTTPUtil,
    DateUtil,
    SMTPConnectionFactory,
    SMTPConnection,
    UUIDGenerator,
    RawMessage,
    ResponseFactory,
    ImmutableResponse,
    NCPDPUtil,
    DICOMUtil,
    AttachmentUtil,
    ChannelUtil,
    Attachment,
    MirthCachedRowSet,
    Future,

    // Userutil classes (Java: importPackage(Packages.com.mirth.connect.userutil))
    XmlUtil,
    JsonUtil,
    Lists,
    ListBuilder,
    Maps,
    MapBuilder,

    // HTTP header/parameter wrappers (Java: importPackage(Packages.com.mirth.connect.userutil))
    MessageHeaders,
    MessageParameters,

    // Serializer factory (Java: importPackage, used by data type scripts)
    SerializerFactory,

    // XSLT transformer for XsltStep plugin scripts
    XsltTransformer,

    // Console for debugging
    console,

    // Sandbox: disable timer functions to prevent scripts from scheduling code
    // that outlives the vm.Script timeout (DoS prevention)
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    queueMicrotask: undefined,

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
  scope.alerts = new RealAlertSender(context.channelId);

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

  // Response map (with destinationIdMap for $r('Destination Name') lookups)
  const destinationIdMap = connectorMessage.getDestinationIdMap();
  const responseMap = new ResponseMap(connectorMessage.getResponseMap(), destinationIdMap);
  scope.responseMap = responseMap;
  scope.$r = responseMap;

  // Override AlertSender with connector-message-aware version
  // (Java: addConnectorMessage line 142 — passes ImmutableConnectorMessage with channelId + metaDataId + connectorName)
  scope.alerts = new RealAlertSender(connectorMessage);

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
  scope.phase = [phase]; // Array with one element, matching Java's String[] phase

  // Inject destinationSet for source connector scripts
  if (context.metaDataId === 0 || context.metaDataId === undefined) {
    scope.destinationSet = new DestinationSet(connectorMessage as any);
  }

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

  // Inject destinationSet for preprocessor
  if (context.metaDataId === 0 || context.metaDataId === undefined) {
    scope.destinationSet = new DestinationSet(connectorMessage as any);
  }

  return scope;
}

/**
 * Build scope for postprocessor scripts
 */
export function buildPostprocessorScope(
  context: ScriptContext,
  message: Message,
  response?: Response
): Scope {
  const scope = buildChannelScope(context);

  // Full message object
  scope.message = message;

  // Java: addMessage() → message.getMergedConnectorMessage() creates a synthetic
  // ConnectorMessage merging maps from ALL connectors (source + destinations).
  // This enables $r('HTTP Sender'), $c('key'), $s('key') in postprocessor scripts.
  const mergedConnectorMessage = message.getMergedConnectorMessage();

  scope.connectorMessage = mergedConnectorMessage;
  scope.connector = mergedConnectorMessage.getConnectorName();

  // Source map (from source connector only)
  const sourceMap = new SourceMap(mergedConnectorMessage.getSourceMap());
  scope.sourceMap = sourceMap;
  scope.$s = sourceMap;

  // Channel map (merged from source + all destinations)
  const channelMap = new ChannelMap(mergedConnectorMessage.getChannelMap(), sourceMap);
  scope.channelMap = channelMap;
  scope.$c = channelMap;

  // Connector map (empty for merged — connector maps are per-connector)
  const connectorMap = new MirthMap(mergedConnectorMessage.getConnectorMap());
  scope.connectorMap = connectorMap;
  scope.$co = connectorMap;

  // Response map (merged from source + all destinations, with destinationIdMap)
  const responseMap = new ResponseMap(
    mergedConnectorMessage.getResponseMap(),
    mergedConnectorMessage.getDestinationIdMap()
  );
  scope.responseMap = responseMap;
  scope.$r = responseMap;

  // Inject response if provided (Java overload with Response parameter)
  if (response) {
    scope.response = response;
  }

  return scope;
}

/**
 * Build scope for response transformer scripts
 */
export function buildResponseTransformerScope(
  context: ScriptContext,
  connectorMessage: ConnectorMessage,
  response: Response | { status: Status; statusMessage?: string; error?: string },
  template?: string
): Scope {
  const scope = buildConnectorMessageScope(context, connectorMessage);

  // JRC-SBD-014: Wrap response in ImmutableResponse (Java: addResponse wraps in ImmutableResponse)
  // Scripts expect response.getNewMessageStatus() not response.getStatus()
  const responseObj =
    response instanceof Response
      ? response
      : new Response({
          status: response.status,
          statusMessage: response.statusMessage,
          error: response.error,
        });
  scope.response = new ImmutableResponse(responseObj);
  scope.responseStatus = responseObj.getStatus();
  scope.responseStatusMessage = responseObj.getStatusMessage();
  scope.responseErrorMessage = responseObj.getError();

  // Template for response transformer (Java: add("template", scope, template))
  if (template !== undefined) {
    scope.template = template;
  }

  // Phase array for transformer step execution (matches filter/transformer scope)
  scope.phase = ['response_transform'];

  return scope;
}

/**
 * Build scope for deploy/undeploy scripts
 */
export function buildDeployScope(context: ScriptContext): Scope {
  return buildChannelScope(context);
}

/**
 * Build scope for attachment processing scripts
 * Java: JavaScriptScopeUtil.getAttachmentScope()
 */
export function buildAttachmentScope(
  context: ScriptContext,
  rawData: string,
  sourceMapData: Map<string, unknown>,
  attachments: unknown[],
  isBinary: boolean
): Scope {
  const scope = buildChannelScope(context);

  // Raw message data
  scope.message = rawData;

  // SourceMap (immutable in Java via Collections.unmodifiableMap)
  const sourceMap = new SourceMap(sourceMapData);
  scope.sourceMap = sourceMap;
  scope.$s = sourceMap;

  // Attachment list
  scope.mirth_attachments = attachments;

  // Binary flag
  scope.binary = isBinary;

  return scope;
}

/**
 * Sync maps back to connector message after script execution
 *
 * Note: Since ConnectorMessage maps are passed by reference to MirthMap,
 * modifications are automatically reflected. This function exists for
 * explicit sync operations or to copy from different map instances.
 */
export function syncMapsToConnectorMessage(scope: Scope, connectorMessage: ConnectorMessage): void {
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
 * Build scope for source connector receiver scripts (e.g., onMessageReceived)
 * Java: JavaScriptScopeUtil.getMessageReceiverScope()
 */
export function buildMessageReceiverScope(
  context: ScriptContext,
  connectorMessage?: ConnectorMessage
): Scope {
  const scope = buildChannelScope(context);
  if (connectorMessage) {
    Object.assign(scope, buildConnectorMessageScope(context, connectorMessage));
  }
  return scope;
}

/**
 * Build scope for destination connector dispatcher scripts (e.g., onMessageSent)
 * Java: JavaScriptScopeUtil.getMessageDispatcherScope()
 */
export function buildMessageDispatcherScope(
  context: ScriptContext,
  connectorMessage: ConnectorMessage
): Scope {
  return buildConnectorMessageScope(context, connectorMessage);
}

/**
 * Build scope for batch processing scripts with custom scope objects
 * Java: JavaScriptScopeUtil.getBatchProcessorScope()
 */
export function buildBatchProcessorScope(
  context: ScriptContext,
  scopeObjects: Record<string, unknown>
): Scope {
  const scope = buildBasicScope(context.logger);
  for (const [key, value] of Object.entries(scopeObjects)) {
    scope[key] = value;
  }
  if (context.channelId) {
    // JRC-SVM-005: Match Java's addChannel() — injects alerts, channelId, channelName, globalChannelMap
    scope.channelId = context.channelId;
    scope.channelName = context.channelName;
    scope.alerts = new RealAlertSender(context.channelId);
    const globalChannelMap = GlobalChannelMapStore.getInstance().get(context.channelId);
    scope.globalChannelMap = globalChannelMap;
    scope.$gc = globalChannelMap;
  }
  return scope;
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
    const connectorScope = buildConnectorMessageScope(this.context, connectorMessage, rawContent);
    this.scope = { ...this.scope, ...connectorScope };
    return this;
  }

  /**
   * Add filter/transformer context
   */
  withFilterTransformer(template: string, phase: string): this {
    this.scope.template = template;
    this.scope.phase = [phase];
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
