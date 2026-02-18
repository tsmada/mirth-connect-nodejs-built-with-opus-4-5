/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/Donkey.java
 *
 * Purpose: Message processing engine
 *
 * Key behaviors to replicate:
 * - Manage channel lifecycle
 * - Route messages through channels
 * - Handle message persistence
 */

import { Channel } from './channel/Channel.js';
import { initializeExecutor } from '../javascript/runtime/JavaScriptExecutor.js';
import { getLogger, registerComponent } from '../logging/index.js';

registerComponent('engine', 'Channel deploy/start/stop');
const logger = getLogger('engine');

export class Donkey {
  private channels: Map<string, Channel> = new Map();
  private running = false;
  private initialized = false;

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Donkey engine is already running');
    }

    logger.warn('Starting Donkey engine...');

    // Initialize JavaScript runtime (singleton executor)
    if (!this.initialized) {
      initializeExecutor();
      this.initialized = true;
      logger.warn('JavaScript runtime initialized');
    }

    // Message persistence is handled by DonkeyDao when messages are processed
    // Channel configurations are loaded by Mirth.ts from the database

    this.running = true;
    logger.warn('Donkey engine started');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.warn('Stopping Donkey engine...');

    // Stop all channels
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
    this.channels.clear();

    this.running = false;
    logger.warn('Donkey engine stopped');
  }

  async deployChannel(channel: Channel): Promise<void> {
    if (this.channels.has(channel.getId())) {
      throw new Error(`Channel ${channel.getId()} is already deployed`);
    }

    this.channels.set(channel.getId(), channel);
  }

  async undeployChannel(channelId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} is not deployed`);
    }

    await channel.stop();
    this.channels.delete(channelId);
  }

  getChannel(channelId: string): Channel | undefined {
    return this.channels.get(channelId);
  }

  getChannels(): Channel[] {
    return Array.from(this.channels.values());
  }

  isRunning(): boolean {
    return this.running;
  }
}
