/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/js/JavaScriptReceiver.java
 *
 * Purpose: JavaScript Reader source connector — executes a user script on each poll cycle
 * to generate messages for the channel.
 *
 * Key behaviors:
 * - Extends PollConnector (poll-based source)
 * - Script is E4X-transpiled and compiled at deploy time
 * - Each poll executes the script in a messageReceiverScope
 * - Script result is converted to RawMessage(s) via convertJavaScriptResult():
 *   - null/undefined → no messages
 *   - string → single message
 *   - array → multiple messages (each element toString'd, RawMessage objects used directly)
 *   - RawMessage-like object → used directly
 * - Dispatches READING/IDLE events for dashboard
 * - Dispatches ErrorEvent on script errors
 *
 * @see JavaScriptReceiverProperties
 */

import * as vm from 'vm';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import { getDefaultExecutor } from '../../javascript/runtime/JavaScriptExecutor.js';
import { buildMessageReceiverScope } from '../../javascript/runtime/ScopeBuilder.js';
import { E4XTranspiler } from '../../javascript/e4x/E4XTranspiler.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  getAlertEventController,
  ErrorEventType,
} from '../../javascript/userutil/AlertSender.js';
import {
  JavaScriptReceiverProperties,
  getDefaultJavaScriptReceiverProperties,
  JAVASCRIPT_RECEIVER_NAME,
} from './JavaScriptReceiverProperties.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('javascript', 'Script execution');
const logger = getLogger('javascript');

export interface JavaScriptReceiverConfig {
  name?: string;
  properties?: Partial<JavaScriptReceiverProperties>;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
}

/**
 * Represents a raw message result from the user's script.
 * Matches the shape that Java's convertJavaScriptResult() extracts from RawMessage objects.
 */
interface RawMessageLike {
  rawData: string;
  rawBytes?: Buffer;
  sourceMap?: Map<string, unknown>;
  destinationMetaDataIds?: number[];
}

/**
 * A dispatched message: either a plain string or a RawMessage-like object with sourceMap.
 */
type DispatchableMessage = string | RawMessageLike;

export class JavaScriptReceiver extends SourceConnector {
  private properties: JavaScriptReceiverProperties;
  private compiledScript: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: JavaScriptReceiverConfig) {
    super({
      name: config.name ?? JAVASCRIPT_RECEIVER_NAME,
      transportName: JAVASCRIPT_RECEIVER_NAME,
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });
    this.properties = {
      ...getDefaultJavaScriptReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Deploy: transpile E4X and compile the user script.
   * Matches Java JavaScriptReceiver.onDeploy() (lines 54-68):
   * - Compile script into cache
   * - Dispatch IDLE event
   */
  async onDeploy(): Promise<void> {
    if (this.properties.script) {
      const transpiler = new E4XTranspiler();
      const transpiled = transpiler.transpile(this.properties.script).code;

      // Validate by attempting to compile — throws on syntax error
      // This matches Java's compileAndAddScript() which fails fast on bad scripts.
      // Uses vm.Script directly (not executeRaw) to avoid sealed scope conflicts.
      try {
        new vm.Script(`(function() { ${transpiled} })`, { filename: 'js-reader.js' });
      } catch (compileError) {
        throw new Error(
          `Error compiling ${JAVASCRIPT_RECEIVER_NAME} script: ${compileError instanceof Error ? compileError.message : String(compileError)}`
        );
      }

      this.compiledScript = transpiled;
    }

    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
  }

  /**
   * Undeploy: clear the cached script.
   * Matches Java JavaScriptReceiver.onUndeploy() — removes from compiled script cache.
   */
  async onUndeploy(): Promise<void> {
    this.compiledScript = null;
  }

  /**
   * Start the receiver — begin polling.
   * Matches Java JavaScriptReceiver.onStart() (empty in Java, polling handled by PollConnector).
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('JavaScript Receiver is already running');
    }

    this.running = true;
    this.startPolling();
  }

  /**
   * Stop the receiver — stop polling.
   * Matches Java JavaScriptReceiver.onStop() (empty in Java, stopping handled by PollConnector).
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.stopPolling();
    this.running = false;
  }

  getProperties(): JavaScriptReceiverProperties {
    return this.properties;
  }

  // ── Polling ──────────────────────────────────────────────────────

  private startPolling(): void {
    // First poll runs immediately (matches Java PollConnector behavior)
    this.poll().catch((err) =>
      logger.error('JS Receiver poll error', err as Error)
    );

    this.pollTimer = setInterval(() => {
      this.poll().catch((err) =>
        logger.error('JS Receiver poll error', err as Error)
      );
    }, this.properties.pollInterval);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Execute one poll cycle.
   *
   * Matches Java JavaScriptReceiver.poll() (lines 90-146):
   * 1. Dispatch READING event
   * 2. Execute script in messageReceiverScope
   * 3. Convert result to RawMessage list
   * 4. Dispatch each message to the channel
   * 5. On error, dispatch ErrorEvent + log
   * 6. Dispatch IDLE event in finally
   */
  private async poll(): Promise<void> {
    if (!this.running || !this.compiledScript) return;

    this.dispatchConnectionEvent(ConnectionStatusEventType.READING);

    try {
      const executor = getDefaultExecutor();
      const channelId = this.channel?.getId() ?? '';
      const channelName = this.channel?.getName() ?? '';

      // Build scope — matches Java's getMessageReceiverScope()
      const scope = buildMessageReceiverScope({
        channelId,
        channelName,
        connectorName: this.name,
        metaDataId: 0,
      });

      const result = executor.executeWithScope<unknown>(
        this.compiledScript,
        scope,
        { timeout: 60000 }
      );

      if (!result.success) {
        throw result.error ?? new Error('JavaScript execution failed');
      }

      // Convert result to dispatchable messages
      const messages = this.convertJavaScriptResult(result.result);

      for (const msg of messages) {
        // CPC-W20-006: Check running state before each dispatch (matches Java's isTerminated() check)
        if (!this.running) break;

        if (typeof msg === 'string') {
          await this.dispatchRawMessage(msg);
        } else {
          // RawMessage-like object with sourceMap
          await this.dispatchRawMessage(msg.rawData, msg.sourceMap);
        }
      }
    } catch (error) {
      // CPC-W20-001: Dispatch ErrorEvent matching Java JavaScriptReceiver.poll() catch block
      // Java: eventController.dispatchEvent(new ErrorEvent(getChannelId(), null, null,
      //   ErrorEventType.SOURCE_CONNECTOR, getSourceName(), connectorProperties.getName(), ...))
      const alertController = this.channel ? getAlertEventController() : null;
      if (alertController && this.channel) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        alertController.dispatchEvent({
          channelId: this.channel.getId(),
          eventType: ErrorEventType.SOURCE_CONNECTOR,
          connectorName: this.name,
          errorMessage: `Error polling in ${JAVASCRIPT_RECEIVER_NAME}: ${errorMessage}`,
          throwable: error instanceof Error ? error : undefined,
          timestamp: new Date(),
        });
      }
      logger.error(`Error in JavaScript Receiver poll:`, error as Error);
    } finally {
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  // ── Result Conversion ────────────────────────────────────────────

  /**
   * Convert JavaScript result to dispatachable messages.
   *
   * Matches Java JavaScriptReceiver.convertJavaScriptResult() (lines 167-203):
   * - NativeJavaObject wrapping is not needed in Node.js (values come directly from VM)
   * - null/undefined → empty list
   * - Array → iterate elements, unwrap RawMessage objects or toString()
   * - RawMessage-like object → use rawData + sourceMap
   * - Other → toString() (string, number, etc.)
   * - Empty strings are skipped (matches Java StringUtils.isNotEmpty check)
   */
  private convertJavaScriptResult(result: unknown): DispatchableMessage[] {
    if (result == null) return [];

    if (Array.isArray(result)) {
      const messages: DispatchableMessage[] = [];
      for (const element of result) {
        if (element == null) continue;

        if (this.isRawMessageLike(element)) {
          const rawData = String(element.rawData);
          if (rawData) {
            messages.push({
              rawData,
              sourceMap: element.sourceMap,
              destinationMetaDataIds: element.destinationMetaDataIds,
            });
          }
        } else {
          const rawData = String(element);
          if (rawData) messages.push(rawData);
        }
      }
      return messages;
    }

    if (this.isRawMessageLike(result)) {
      const rawData = String(result.rawData);
      return rawData
        ? [
            {
              rawData,
              sourceMap: result.sourceMap,
              destinationMetaDataIds: result.destinationMetaDataIds,
            },
          ]
        : [];
    }

    // Assume string/number/other — toString()
    const rawData = String(result);
    return rawData ? [rawData] : [];
  }

  /**
   * Check if an object looks like a RawMessage (has rawData property).
   * Matches Java's `instanceof com.mirth.connect.server.userutil.RawMessage` check.
   */
  private isRawMessageLike(obj: unknown): obj is RawMessageLike {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'rawData' in (obj as Record<string, unknown>)
    );
  }
}
