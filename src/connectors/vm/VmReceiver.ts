/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/vm/VmReceiver.java
 *
 * Purpose: VM source connector that receives messages routed from other channels
 *
 * Key behaviors to replicate:
 * - Receive messages via dispatchRawMessage (not network I/O)
 * - Emit connection status events (IDLE, RECEIVING, DISCONNECTED)
 * - Support batch message handling
 * - Handle recovered responses from destination connectors
 */

import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import { RawMessage } from '../../model/RawMessage.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  VmReceiverProperties,
  getDefaultVmReceiverProperties,
} from './VmConnectorProperties.js';

/**
 * Connection status event types for VM connector
 */
export enum VmConnectionStatus {
  IDLE = 'IDLE',
  RECEIVING = 'RECEIVING',
  DISCONNECTED = 'DISCONNECTED',
}

/**
 * Event listener for connection status changes
 */
export type ConnectionStatusListener = (status: VmConnectionStatus) => void;

export interface VmReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<VmReceiverProperties>;
}

/**
 * VM Source Connector - "Channel Reader"
 *
 * Unlike network connectors, the VM receiver doesn't listen on a port.
 * Instead, it receives messages programmatically when another channel's
 * VM dispatcher routes a message to this channel.
 */
export class VmReceiver extends SourceConnector {
  private properties: VmReceiverProperties;
  private statusListeners: ConnectionStatusListener[] = [];

  constructor(config: VmReceiverConfig = {}) {
    super({
      name: config.name ?? 'Channel Reader',
      transportName: 'VM',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultVmReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Get the connector name (matches Java implementation)
   */
  static getConnectorName(): string {
    return 'Channel Reader';
  }

  /**
   * Get the protocol name
   */
  static getProtocol(): string {
    return 'VM';
  }

  /**
   * Get the connector properties
   */
  getProperties(): VmReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<VmReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Add a connection status listener
   */
  addStatusListener(listener: ConnectionStatusListener): void {
    this.statusListeners.push(listener);
  }

  /**
   * Remove a connection status listener
   */
  removeStatusListener(listener: ConnectionStatusListener): void {
    const index = this.statusListeners.indexOf(listener);
    if (index !== -1) {
      this.statusListeners.splice(index, 1);
    }
  }

  /**
   * Dispatch a connection status event
   */
  private dispatchStatusEvent(status: VmConnectionStatus): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.error('Error in connection status listener:', error);
      }
    }
  }

  /**
   * Start the VM receiver
   *
   * Unlike network connectors, starting a VM receiver just marks it as ready
   * to receive routed messages - there's no port to bind.
   * Matches Java VmReceiver.onStart() which dispatches IDLE event.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('VM Receiver is already running');
    }

    this.running = true;
    // Dispatch via base class for dashboard integration
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    this.dispatchStatusEvent(VmConnectionStatus.IDLE);
  }

  /**
   * Stop the VM receiver
   * Matches Java VmReceiver.onStop()/onHalt() which dispatches DISCONNECTED event.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    // Dispatch via base class for dashboard integration
    this.dispatchConnectionEvent(ConnectionStatusEventType.DISCONNECTED);
    this.dispatchStatusEvent(VmConnectionStatus.DISCONNECTED);
  }

  /**
   * Dispatch a raw message to the channel pipeline.
   *
   * This is called by VmDispatcher when routing messages between channels.
   * Unlike the base class method, this one emits status events.
   *
   * @param rawMessage The raw message to dispatch
   */
  async dispatchVmMessage(rawMessage: RawMessage): Promise<void> {
    if (!this.running) {
      throw new Error('VM Receiver is not running');
    }

    if (!this.channel) {
      throw new Error('VM Receiver is not attached to a channel');
    }

    this.dispatchStatusEvent(VmConnectionStatus.RECEIVING);

    try {
      // Get the raw data - either string or convert from bytes
      const rawData = rawMessage.isBinary()
        ? rawMessage.getRawBytes()?.toString('utf-8') ?? rawMessage.getRawData()
        : rawMessage.getRawData();

      // Dispatch to the channel
      await this.channel.dispatchRawMessage(rawData, rawMessage.getSourceMap());
    } finally {
      this.dispatchStatusEvent(VmConnectionStatus.IDLE);
    }
  }

  /**
   * Dispatch a batch of raw messages.
   *
   * @param messages Array of raw messages to dispatch
   * @returns True if all messages were dispatched successfully
   */
  async dispatchVmBatchMessages(messages: RawMessage[]): Promise<boolean> {
    if (!this.running) {
      throw new Error('VM Receiver is not running');
    }

    if (!this.properties.canBatch) {
      throw new Error('VM Receiver does not support batch messages');
    }

    this.dispatchStatusEvent(VmConnectionStatus.RECEIVING);

    try {
      for (const message of messages) {
        await this.dispatchVmMessage(message);
      }
      return true;
    } finally {
      this.dispatchStatusEvent(VmConnectionStatus.IDLE);
    }
  }

  /**
   * Handle a recovered response from a destination connector.
   *
   * When a destination connector recovers (e.g., after a crash), this method
   * is called to finish processing any pending responses.
   *
   * @param dispatchResult The result from the destination dispatch
   */
  handleRecoveredResponse(dispatchResult: unknown): void {
    // In the Java implementation, this calls finishDispatch(dispatchResult)
    // For now, we log the recovery
    console.info('VM Receiver handling recovered response:', dispatchResult);
  }
}
