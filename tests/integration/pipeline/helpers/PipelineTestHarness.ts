/**
 * PipelineTestHarness — Channel factory + assertion utilities for pipeline lifecycle tests.
 *
 * Provides:
 * - TestSourceConnector with testDispatch() method
 * - TestDestinationConnector with configurable send behavior (success/error/response)
 * - PipelineTestHarness with fluent configuration API
 * - Map singleton reset helper
 */

import { Channel, ChannelConfig } from '../../../../src/donkey/channel/Channel';
import { SourceConnector } from '../../../../src/donkey/channel/SourceConnector';
import { DestinationConnector } from '../../../../src/donkey/channel/DestinationConnector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Message } from '../../../../src/model/Message';
import {
  FilterRule,
  TransformerStep,
} from '../../../../src/javascript/runtime/ScriptBuilder';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// ─────────────────────────────────────────────────────
// Test Source Connector
// ─────────────────────────────────────────────────────

export class TestSourceConnector extends SourceConnector {
  public started = false;
  public lastDispatchedMessage: Message | null = null;

  constructor(name: string = 'Test Source') {
    super({
      name,
      transportName: 'TEST',
    });
  }

  async start(): Promise<void> {
    this.running = true;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.started = false;
  }

  /**
   * Public method to dispatch a raw message for testing.
   * Returns the processed Message object.
   */
  async testDispatch(rawData: string, sourceMap?: Map<string, unknown>): Promise<Message> {
    return this.dispatchRawMessage(rawData, sourceMap);
  }
}

// ─────────────────────────────────────────────────────
// Test Destination Connector
// ─────────────────────────────────────────────────────

export type SendBehavior = 'success' | 'error' | 'queued-error';

export class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  public responseData: string | null = null;
  public sendBehavior: SendBehavior = 'success';
  public errorMessage: string = 'Connection refused';

  constructor(metaDataId: number, name: string = `Dest ${metaDataId}`) {
    super({
      name,
      metaDataId,
      transportName: 'TEST',
    });
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(connectorMessage: ConnectorMessage): Promise<void> {
    if (this.sendBehavior === 'error' || this.sendBehavior === 'queued-error') {
      throw new Error(this.errorMessage);
    }
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }

  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return this.responseData;
  }

  /** Configure this destination to throw on send (for ERROR scenarios) */
  setSendError(msg: string = 'Connection refused'): this {
    this.sendBehavior = 'error';
    this.errorMessage = msg;
    return this;
  }

  /** Configure a response string this destination returns after send */
  setResponse(data: string): this {
    this.responseData = data;
    return this;
  }

  /** Enable queue on this destination */
  enableQueue(): this {
    this.queueEnabled = true;
    return this;
  }
}

// ─────────────────────────────────────────────────────
// Pipeline Test Harness — Fluent Channel Factory
// ─────────────────────────────────────────────────────

export interface HarnessOptions {
  channelId?: string;
  channelName?: string;
  preprocessorScript?: string;
  postprocessorScript?: string;
  globalPreprocessorScript?: string;
  globalPostprocessorScript?: string;
  deployScript?: string;
  undeployScript?: string;
  sourceFilterRules?: FilterRule[];
  sourceTransformerSteps?: TransformerStep[];
  sourceTemplate?: string;
  destinations?: DestinationConfig[];
}

export interface DestinationConfig {
  name?: string;
  filterRules?: FilterRule[];
  transformerSteps?: TransformerStep[];
  template?: string;
  responseTransformerSteps?: TransformerStep[];
  responseTemplate?: string;
  sendBehavior?: SendBehavior;
  sendErrorMsg?: string;
  responseData?: string | null;
  queueEnabled?: boolean;
}

/**
 * Create a filter rule from a raw JavaScript script.
 * The script should `return true` to accept or `return false` to reject.
 */
export function filterRule(script: string, name: string = 'rule'): FilterRule {
  return { name, script, operator: 'AND', enabled: true };
}

/**
 * Create a transformer step from a raw JavaScript script.
 */
export function transformerStep(script: string, name: string = 'step'): TransformerStep {
  return { name, script, enabled: true };
}

export class PipelineTestHarness {
  private channel!: Channel;
  private source!: TestSourceConnector;
  private destinations: TestDestinationConnector[] = [];

  /**
   * Build a channel with the given options.
   * Resets all singletons before construction.
   */
  build(options: HarnessOptions = {}): this {
    // Reset singletons — critical for isolation between tests
    resetAllSingletons();

    const config: ChannelConfig = {
      id: options.channelId ?? 'test-pipeline-channel',
      name: options.channelName ?? 'Pipeline Test',
      enabled: true,
      preprocessorScript: options.preprocessorScript,
      postprocessorScript: options.postprocessorScript,
      globalPreprocessorScript: options.globalPreprocessorScript,
      globalPostprocessorScript: options.globalPostprocessorScript,
      deployScript: options.deployScript,
      undeployScript: options.undeployScript,
    };

    this.channel = new Channel(config);
    this.source = new TestSourceConnector('Test Source');

    // IMPORTANT: setSourceConnector MUST be called BEFORE setFilterTransformer.
    // setSourceConnector → setChannel → createFilterTransformerExecutor (empty).
    // setFilterTransformer then calls setScripts() on the existing executor.
    // If reversed, setChannel overwrites the executor that has scripts.
    this.channel.setSourceConnector(this.source);

    // Set source filter/transformer if provided
    if (options.sourceFilterRules || options.sourceTransformerSteps) {
      this.source.setFilterTransformer({
        filterRules: options.sourceFilterRules,
        transformerSteps: options.sourceTransformerSteps,
        template: options.sourceTemplate,
      });
    }

    // Build destinations
    const destConfigs = options.destinations ?? [{}];
    this.destinations = [];

    for (let i = 0; i < destConfigs.length; i++) {
      const dc = destConfigs[i]!;
      const dest = new TestDestinationConnector(i + 1, dc.name ?? `Dest ${i + 1}`);

      if (dc.sendBehavior === 'error' || dc.sendBehavior === 'queued-error') {
        dest.setSendError(dc.sendErrorMsg ?? 'Connection refused');
      }
      if (dc.responseData !== undefined) {
        dest.responseData = dc.responseData;
      }
      if (dc.queueEnabled) {
        dest.enableQueue();
      }

      // IMPORTANT: addDestinationConnector MUST be called BEFORE setFilterTransformer.
      // Same reason as source — setChannel overwrites the executor.
      this.channel.addDestinationConnector(dest);

      // Set filter/transformer/response transformer AFTER adding to channel
      if (dc.filterRules || dc.transformerSteps || dc.responseTransformerSteps) {
        dest.setFilterTransformer({
          filterRules: dc.filterRules,
          transformerSteps: dc.transformerSteps,
          template: dc.template,
          responseTransformerScripts: dc.responseTransformerSteps
            ? {
                transformerSteps: dc.responseTransformerSteps,
                template: dc.responseTemplate,
              }
            : undefined,
        });
      }

      this.destinations.push(dest);
    }

    return this;
  }

  getChannel(): Channel {
    return this.channel;
  }

  getSource(): TestSourceConnector {
    return this.source;
  }

  getDestination(index: number = 0): TestDestinationConnector {
    return this.destinations[index]!;
  }

  getDestinations(): TestDestinationConnector[] {
    return this.destinations;
  }

  /**
   * Dispatch a raw message through the full pipeline.
   * Returns the completed Message object with all connector messages.
   */
  async dispatch(rawData: string, sourceMap?: Map<string, unknown>): Promise<Message> {
    return this.source.testDispatch(rawData, sourceMap);
  }
}

// ─────────────────────────────────────────────────────
// Singleton Reset Helper
// ─────────────────────────────────────────────────────

/**
 * Reset all singletons that persist state between tests.
 * Must be called in beforeEach to ensure test isolation.
 */
export function resetAllSingletons(): void {
  resetDefaultExecutor();
  GlobalMap.resetInstance();
  ConfigurationMap.resetInstance();
  GlobalChannelMapStore.resetInstance();
}
