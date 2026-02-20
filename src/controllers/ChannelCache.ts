/**
 * Synchronous channel cache for ChannelUtil adapters.
 *
 * ChannelUtil methods are called from VM scripts which require synchronous access
 * to channel name/ID lookups. This module maintains an in-memory cache that is:
 * - Populated at startup by Mirth.ts
 * - Refreshed after channel CRUD operations by ChannelServlet
 *
 * This avoids circular imports between Mirth.ts and servlet code.
 */

import { ChannelController } from './ChannelController.js';

// Synchronous caches
let channelNameCache: string[] = [];
let channelIdCache: string[] = [];
const channelCacheById = new Map<string, { id: string; name: string }>();
const channelCacheByName = new Map<string, { id: string; name: string }>();

/**
 * Refresh the channel cache from the database.
 * Call after any channel create, update, or delete operation.
 */
export async function refreshChannelCache(): Promise<void> {
  try {
    const allChannels = await ChannelController.getAllChannels();
    channelNameCache = allChannels.map((c) => c.name);
    channelIdCache = allChannels.map((c) => c.id);
    channelCacheById.clear();
    channelCacheByName.clear();
    for (const ch of allChannels) {
      const entry = { id: ch.id, name: ch.name };
      channelCacheById.set(ch.id, entry);
      channelCacheByName.set(ch.name, entry);
    }
  } catch {
    // Non-fatal — cache remains as-is
  }
}

/** Get cached channel names (synchronous) */
export function getChannelNames(): string[] {
  return channelNameCache;
}

/** Get cached channel IDs (synchronous) */
export function getChannelIds(): string[] {
  return channelIdCache;
}

/** Get a cached channel by ID (synchronous) */
export function getChannelById(channelId: string): { id: string; name: string } | null {
  return channelCacheById.get(channelId) ?? null;
}

/** Get a cached channel by name (synchronous) */
export function getChannelByName(channelName: string): { id: string; name: string } | null {
  return channelCacheByName.get(channelName) ?? null;
}
