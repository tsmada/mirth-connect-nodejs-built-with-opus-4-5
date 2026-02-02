/**
 * Channel Resolver
 *
 * Resolves channel names to IDs and vice versa.
 * Allows users to reference channels by name or partial name instead of UUID.
 */

import { ApiClient } from './ApiClient.js';

/**
 * Resolved channel information
 */
export interface ResolvedChannel {
  id: string;
  name: string;
}

/**
 * Result of channel resolution
 */
export type ChannelResolutionResult =
  | { success: true; channel: ResolvedChannel }
  | { success: false; error: string; suggestions?: ResolvedChannel[] };

/**
 * Check if a string looks like a UUID
 */
function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Channel resolver class
 */
export class ChannelResolver {
  private client: ApiClient;
  private cache: Map<string, string> | null = null; // name -> id
  private reverseCache: Map<string, string> | null = null; // id -> name

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Load channel IDs and names into cache
   */
  private async loadCache(): Promise<void> {
    if (this.cache !== null) return;

    const idsAndNames = await this.client.getChannelIdsAndNames();

    this.cache = new Map();
    this.reverseCache = new Map();

    for (const [id, name] of Object.entries(idsAndNames)) {
      this.cache.set(name.toLowerCase(), id);
      this.reverseCache.set(id, name);
    }
  }

  /**
   * Clear the cache (call when channels may have changed)
   */
  clearCache(): void {
    this.cache = null;
    this.reverseCache = null;
  }

  /**
   * Resolve a channel identifier (name or ID) to its ID
   */
  async resolve(identifier: string): Promise<ChannelResolutionResult> {
    await this.loadCache();

    // If it's already a UUID, verify it exists
    if (isUuid(identifier)) {
      const name = this.reverseCache!.get(identifier);
      if (name) {
        return { success: true, channel: { id: identifier, name } };
      }
      return { success: false, error: `Channel with ID '${identifier}' not found` };
    }

    // Try exact match (case-insensitive)
    const exactMatch = this.cache!.get(identifier.toLowerCase());
    if (exactMatch) {
      return {
        success: true,
        channel: {
          id: exactMatch,
          name: this.reverseCache!.get(exactMatch)!,
        },
      };
    }

    // Try partial match
    const searchLower = identifier.toLowerCase();
    const matches: ResolvedChannel[] = [];

    for (const [name, id] of this.cache!.entries()) {
      if (name.includes(searchLower)) {
        matches.push({ id, name: this.reverseCache!.get(id)! });
      }
    }

    if (matches.length === 1) {
      return { success: true, channel: matches[0]! };
    }

    if (matches.length > 1) {
      return {
        success: false,
        error: `Multiple channels match '${identifier}'`,
        suggestions: matches.slice(0, 5), // Limit suggestions
      };
    }

    return { success: false, error: `Channel '${identifier}' not found` };
  }

  /**
   * Get channel name by ID
   */
  async getName(channelId: string): Promise<string | null> {
    await this.loadCache();
    return this.reverseCache!.get(channelId) || null;
  }

  /**
   * Get all channel IDs and names
   */
  async getAll(): Promise<ResolvedChannel[]> {
    await this.loadCache();

    const channels: ResolvedChannel[] = [];
    for (const [id, name] of this.reverseCache!.entries()) {
      channels.push({ id, name });
    }
    return channels;
  }

  /**
   * Resolve multiple identifiers
   */
  async resolveMany(identifiers: string[]): Promise<{
    resolved: ResolvedChannel[];
    failed: Array<{ identifier: string; error: string }>;
  }> {
    const resolved: ResolvedChannel[] = [];
    const failed: Array<{ identifier: string; error: string }> = [];

    for (const identifier of identifiers) {
      const result = await this.resolve(identifier);
      if (result.success) {
        resolved.push(result.channel);
      } else {
        failed.push({ identifier, error: result.error });
      }
    }

    return { resolved, failed };
  }
}

/**
 * Create a channel resolver with a new API client
 */
export function createChannelResolver(client: ApiClient): ChannelResolver {
  return new ChannelResolver(client);
}

export default ChannelResolver;
