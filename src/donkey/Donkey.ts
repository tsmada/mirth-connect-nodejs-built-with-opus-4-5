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

export class Donkey {
  private channels: Map<string, Channel> = new Map();
  private running = false;

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Donkey engine is already running');
    }

    console.warn('Starting Donkey engine...');

    // TODO: Initialize message persistence
    // TODO: Load channel configurations
    // TODO: Initialize JavaScript runtime

    this.running = true;
    console.warn('Donkey engine started');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.warn('Stopping Donkey engine...');

    // Stop all channels
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
    this.channels.clear();

    this.running = false;
    console.warn('Donkey engine stopped');
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
