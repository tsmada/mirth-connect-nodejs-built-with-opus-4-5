/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/js/JavaScriptDispatcher.java
 *
 * Purpose: JavaScript Writer destination connector — executes a user script for each message
 * and converts the result to a Response.
 *
 * Key behaviors:
 * - Extends DestinationConnector
 * - Script is E4X-transpiled and compiled at deploy time
 * - send() executes the script in a messageDispatcherScope (has access to connectorMessage, msg, etc.)
 * - Script result is converted to Response:
 *   - Response object → used directly
 *   - Status enum → Response(status, null)
 *   - string → Response(SENT, string)
 *   - null/undefined → Response(SENT, null, "JavaScript evaluation successful.")
 * - replaceConnectorProperties() is a no-op (Java line 87 — the script IS the connector)
 * - Dispatches SENDING/IDLE events for dashboard
 * - On error, returns Response(ERROR, ...) with error details
 *
 * @see JavaScriptDispatcherProperties
 */

import * as vm from 'vm';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Response } from '../../model/Response.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { getDefaultExecutor } from '../../javascript/runtime/JavaScriptExecutor.js';
import { buildMessageDispatcherScope } from '../../javascript/runtime/ScopeBuilder.js';
import { E4XTranspiler } from '../../javascript/e4x/E4XTranspiler.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import { getAlertEventController, ErrorEventType } from '../../javascript/userutil/AlertSender.js';
import {
  JavaScriptDispatcherProperties,
  getDefaultJavaScriptDispatcherProperties,
  JAVASCRIPT_DISPATCHER_NAME,
} from './JavaScriptDispatcherProperties.js';

export interface JavaScriptDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<JavaScriptDispatcherProperties>;
}

export class JavaScriptDispatcher extends DestinationConnector {
  private properties: JavaScriptDispatcherProperties;
  private compiledScript: string | null = null;

  constructor(config: JavaScriptDispatcherConfig) {
    super({
      name: config.name ?? JAVASCRIPT_DISPATCHER_NAME,
      transportName: JAVASCRIPT_DISPATCHER_NAME,
      metaDataId: config.metaDataId,
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });
    this.properties = {
      ...getDefaultJavaScriptDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Deploy: transpile E4X and compile the user script.
   *
   * Matches Java JavaScriptDispatcher.onDeploy() (lines 56-69):
   * - Compile script into cache
   * - Dispatch IDLE event
   */
  async onDeploy(): Promise<void> {
    if (this.properties.script) {
      const transpiler = new E4XTranspiler();
      const transpiled = transpiler.transpile(this.properties.script).code;

      // Validate by attempting to compile — throws on syntax error.
      // Uses vm.Script directly (not executeRaw) to avoid sealed scope conflicts.
      try {
        new vm.Script(`(function() { ${transpiled} })`, { filename: 'js-writer.js' });
      } catch (compileError) {
        throw new Error(
          `Error compiling/adding script: ${compileError instanceof Error ? compileError.message : String(compileError)}`
        );
      }

      this.compiledScript = transpiled;
    }

    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
  }

  /**
   * Undeploy: clear the cached script.
   * Matches Java JavaScriptDispatcher.onUndeploy() — removes from compiled script cache.
   */
  async onUndeploy(): Promise<void> {
    this.compiledScript = null;
  }

  /**
   * replaceConnectorProperties — explicit no-op.
   *
   * Matches Java JavaScriptDispatcher.replaceConnectorProperties() (line 87):
   * The script IS the connector logic. There are no ${variable} properties to resolve.
   */
  replaceConnectorProperties(
    props: JavaScriptDispatcherProperties,
    _connectorMessage: ConnectorMessage
  ): JavaScriptDispatcherProperties {
    return props;
  }

  getProperties(): JavaScriptDispatcherProperties {
    return this.properties;
  }

  /**
   * Send a message by executing the user script.
   *
   * Matches Java JavaScriptDispatcher.send() (lines 90-120) and
   * JavaScriptDispatcherTask.doCall() (lines 131-201):
   *
   * 1. Dispatch SENDING event
   * 2. Build messageDispatcherScope (has connectorMessage, msg, maps, etc.)
   * 3. Execute compiled script in that scope
   * 4. Convert result to Response:
   *    - Response object → use directly
   *    - Status enum → Response(status)
   *    - string → Response(SENT, string)
   *    - null/undefined → Response(SENT, null, "JavaScript evaluation successful.")
   * 5. On error → Response(ERROR, null, errorMessage, errorDetails)
   * 6. Dispatch IDLE event in finally
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.dispatchConnectionEvent(ConnectionStatusEventType.SENDING);

    let responseData: string | null = null;
    let responseError: string | null = null;
    let responseStatus: Status = Status.SENT;

    try {
      if (!this.compiledScript) {
        // Script not compiled — matches Java "Script not found in cache" error path
        responseError = `Error: ${JAVASCRIPT_DISPATCHER_NAME} script not found in cache.`;
        responseStatus = Status.ERROR;
      } else {
        const executor = getDefaultExecutor();
        const channelId = this.channel?.getId() ?? '';
        const channelName = this.channel?.getName() ?? '';

        // Build scope — matches Java's getMessageDispatcherScope()
        const scope = buildMessageDispatcherScope(
          {
            channelId,
            channelName,
            connectorName: this.name,
            metaDataId: this.metaDataId,
          },
          connectorMessage
        );

        const result = executor.executeWithScope<unknown>(this.compiledScript, scope, {
          timeout: 60000,
        });

        if (!result.success) {
          const err = result.error ?? new Error('Script execution failed');
          responseError = err.message;
          responseStatus = Status.ERROR;

          // CPC-W20-002: Dispatch ErrorEvent for script execution failures
          // executeWithScope wraps errors in result.success=false rather than throwing
          const alertController = this.channel ? getAlertEventController() : null;
          if (alertController && this.channel) {
            alertController.dispatchEvent({
              channelId: this.channel.getId(),
              metaDataId: this.metaDataId,
              messageId: connectorMessage.getMessageId(),
              eventType: ErrorEventType.DESTINATION_CONNECTOR,
              connectorName: this.name,
              errorMessage: `Error executing ${JAVASCRIPT_DISPATCHER_NAME} script: ${err.message}`,
              throwable: err,
              timestamp: new Date(),
            });
          }
        } else if (result.result != null) {
          // Convert result — matches Java's doCall() result handling (lines 151-174)
          const converted = this.convertScriptResult(result.result);
          responseStatus = converted.status;
          responseData = converted.data;
        }
        // If result is null/undefined, defaults are used (SENT status)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      responseError = errorMessage;
      responseStatus = Status.ERROR;

      // CPC-W20-002: Dispatch ErrorEvent matching Java JavaScriptDispatcherTask.doCall() catch block
      // Java: eventController.dispatchEvent(new ErrorEvent(getChannelId(), getMetaDataId(),
      //   connectorMessage.getMessageId(), ErrorEventType.DESTINATION_CONNECTOR, ...))
      const alertController = this.channel ? getAlertEventController() : null;
      if (alertController && this.channel) {
        alertController.dispatchEvent({
          channelId: this.channel.getId(),
          metaDataId: this.metaDataId,
          messageId: connectorMessage.getMessageId(),
          eventType: ErrorEventType.DESTINATION_CONNECTOR,
          connectorName: this.name,
          errorMessage: `Error executing ${JAVASCRIPT_DISPATCHER_NAME} script: ${errorMessage}`,
          throwable: error instanceof Error ? error : undefined,
          timestamp: new Date(),
        });
      }
    } finally {
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }

    // Build and apply response to connector message
    connectorMessage.setStatus(responseStatus);
    connectorMessage.setSendDate(new Date());

    if (responseData) {
      connectorMessage.setContent({
        contentType: ContentType.RESPONSE,
        content: responseData,
        dataType: 'RAW',
        encrypted: false,
      });
    }

    if (responseError) {
      connectorMessage.setProcessingError(responseError);
    }
  }

  /**
   * Get the response for the sent message.
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content ?? null;
  }

  // ── Result Conversion ────────────────────────────────────────────

  /**
   * Convert the script's return value to a response.
   *
   * Matches Java JavaScriptDispatcherTask.doCall() (lines 151-174):
   * - Response object → use directly (status + message + statusMessage + error)
   * - Status enum string → use as status
   * - Other → toString() as response data
   */
  private convertScriptResult(result: unknown): {
    status: Status;
    data: string | null;
  } {
    // CPC-W20-009: Use duck-typing instead of instanceof for Response detection.
    // Objects created inside a VM sandbox have a different Response prototype than
    // the host context, so `instanceof Response` fails. Check for getStatus/getMessage
    // methods instead — this matches Java's approach (instanceof works in Rhino because
    // it shares the same classloader, but Node.js VM contexts create separate realms).
    if (this.isResponseLike(result)) {
      const r = result as Response;
      return {
        status: r.getStatus(),
        data: r.getMessage() || null,
      };
    }

    // Check if result is a Status enum value
    if (typeof result === 'string' && Object.values(Status).includes(result as Status)) {
      return {
        status: result as Status,
        data: null,
      };
    }

    // Default: treat as string response data with SENT status
    return {
      status: Status.SENT,
      data: String(result),
    };
  }

  /**
   * Duck-type check for Response objects (works across VM contexts).
   */
  private isResponseLike(obj: unknown): boolean {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as any).getStatus === 'function' &&
      typeof (obj as any).getMessage === 'function'
    );
  }
}
