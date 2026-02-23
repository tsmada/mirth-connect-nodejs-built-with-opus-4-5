/**
 * Group Resolver
 *
 * Resolves channel group names to IDs and vice versa.
 * Allows users to reference groups by name or partial name instead of UUID.
 * Follows the same pattern as ChannelResolver.
 */

import { ApiClient } from './ApiClient.js';

export interface ResolvedGroup {
  id: string;
  name: string;
}

export type GroupResolutionResult =
  | { success: true; group: ResolvedGroup }
  | { success: false; error: string; suggestions?: ResolvedGroup[] };

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export class GroupResolver {
  private client: ApiClient;
  private cache: Map<string, ResolvedGroup> | null = null; // lowercaseName -> {id, name}
  private idCache: Map<string, string> | null = null; // id -> name

  constructor(client: ApiClient) {
    this.client = client;
  }

  private async loadCache(): Promise<void> {
    if (this.cache !== null) return;

    const groups = await this.client.getChannelGroups();

    this.cache = new Map();
    this.idCache = new Map();

    for (const group of groups) {
      this.cache.set(group.name.toLowerCase(), { id: group.id, name: group.name });
      this.idCache.set(group.id, group.name);
    }
  }

  clearCache(): void {
    this.cache = null;
    this.idCache = null;
  }

  async resolve(identifier: string): Promise<GroupResolutionResult> {
    await this.loadCache();

    // UUID lookup
    if (isUuid(identifier)) {
      const name = this.idCache!.get(identifier);
      if (name) {
        return { success: true, group: { id: identifier, name } };
      }
      return { success: false, error: `Group with ID '${identifier}' not found` };
    }

    // Exact match (case-insensitive)
    const exact = this.cache!.get(identifier.toLowerCase());
    if (exact) {
      return { success: true, group: exact };
    }

    // Partial match
    const searchLower = identifier.toLowerCase();
    const matches: ResolvedGroup[] = [];

    for (const [name, group] of this.cache!.entries()) {
      if (name.includes(searchLower)) {
        matches.push(group);
      }
    }

    if (matches.length === 1) {
      return { success: true, group: matches[0]! };
    }

    if (matches.length > 1) {
      return {
        success: false,
        error: `Multiple groups match '${identifier}'`,
        suggestions: matches.slice(0, 5),
      };
    }

    return { success: false, error: `Group '${identifier}' not found` };
  }

  async getName(groupId: string): Promise<string | null> {
    await this.loadCache();
    return this.idCache!.get(groupId) || null;
  }

  async getAll(): Promise<ResolvedGroup[]> {
    await this.loadCache();
    return Array.from(this.cache!.values());
  }
}
