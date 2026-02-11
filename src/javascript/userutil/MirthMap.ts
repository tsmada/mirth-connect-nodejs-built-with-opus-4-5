/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/
 *
 * Purpose: Java-compatible Map implementations for Mirth scope variables
 *
 * Key behaviors to replicate:
 * - get/put with key-value pairs
 * - containsKey check
 * - Java-style method names (get, put, containsKey, etc.)
 */

import type { MapBackend } from '../../cluster/MapBackend.js';
import type { RowDataPacket } from 'mysql2/promise';

/**
 * Base MirthMap class - Java-compatible Map for script scope
 */
export class MirthMap {
  protected data: Map<string, unknown>;

  constructor(initial?: Map<string, unknown> | Record<string, unknown>) {
    if (initial instanceof Map) {
      this.data = new Map(initial);
    } else if (initial) {
      this.data = new Map(Object.entries(initial));
    } else {
      this.data = new Map();
    }
  }

  /**
   * Get value by key
   */
  get(key: string): unknown {
    return this.data.get(key);
  }

  /**
   * Put value by key, returns previous value
   */
  put(key: string, value: unknown): unknown {
    const previous = this.data.get(key);
    this.data.set(key, value);
    return previous;
  }

  /**
   * Check if key exists
   */
  containsKey(key: string): boolean {
    return this.data.has(key);
  }

  /**
   * Remove key and return value
   */
  remove(key: string): unknown {
    const value = this.data.get(key);
    this.data.delete(key);
    return value;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Get number of entries
   */
  size(): number {
    return this.data.size;
  }

  /**
   * Check if map is empty
   */
  isEmpty(): boolean {
    return this.data.size === 0;
  }

  /**
   * Get all keys
   */
  keySet(): string[] {
    return Array.from(this.data.keys());
  }

  /**
   * Get all values
   */
  values(): unknown[] {
    return Array.from(this.data.values());
  }

  /**
   * Get entries as array of [key, value] pairs
   */
  entrySet(): Array<[string, unknown]> {
    return Array.from(this.data.entries());
  }

  /**
   * Get underlying Map for iteration
   */
  getMap(): Map<string, unknown> {
    return this.data;
  }

  /**
   * Convert to plain object
   */
  toObject(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.data) {
      result[key] = value;
    }
    return result;
  }
}

/**
 * SourceMap - Immutable map for source connector variables
 * From: com.mirth.connect.server.userutil.SourceMap
 */
export class SourceMap extends MirthMap {
  constructor(initial?: Map<string, unknown> | Record<string, unknown>) {
    super(initial);
  }

  /**
   * SourceMap.put is a plain delegate — Java SourceMap does NOT log any warning.
   * (The Node.js port incorrectly added a console.warn; removed for parity.)
   */
}

/**
 * ChannelMap - Map with sourceMap fallback for channel-scoped variables
 * From: com.mirth.connect.server.userutil.ChannelMap
 */
export class ChannelMap extends MirthMap {
  private sourceMap: SourceMap;

  constructor(
    initial?: Map<string, unknown> | Record<string, unknown>,
    sourceMap?: SourceMap
  ) {
    super(initial);
    this.sourceMap = sourceMap ?? new SourceMap();
  }

  /**
   * Get with fallback to sourceMap if not found in channelMap.
   * Java logs an ERROR when the sourceMap fallback fires, warning
   * developers that this retrieval method is deprecated.
   */
  override get(key: string): unknown {
    if (this.data.has(key)) {
      return this.data.get(key);
    }
    if (this.sourceMap.containsKey(key)) {
      console.error(
        `The source map entry "${key}" was retrieved from the channel map. ` +
        `This method of retrieval has been deprecated and will soon be removed. ` +
        `Please use sourceMap.get('${key}') instead.`
      );
      return this.sourceMap.get(key);
    }
    return undefined;
  }

  /**
   * Check only the channelMap delegate (not sourceMap).
   * Java's ChannelMap.containsKey() only checks the delegate.
   */
  override containsKey(key: string): boolean {
    return this.data.has(key);
  }

  /**
   * Get the associated sourceMap
   */
  getSourceMap(): SourceMap {
    return this.sourceMap;
  }
}

/**
 * ResponseMap - Map for response variables with destination ID mapping
 * From: com.mirth.connect.userutil.ResponseMap
 */
export class ResponseMap extends MirthMap {
  private destinationIdMap: Map<string, number>;

  constructor(
    initial?: Map<string, unknown> | Record<string, unknown>,
    destinationIdMap?: Map<string, number>
  ) {
    super(initial);
    this.destinationIdMap = destinationIdMap ?? new Map();
  }

  /**
   * Get value by key, with fallback to d# lookup via destinationIdMap.
   * Java's ResponseMap.get(key) checks direct key first, then tries
   * "d" + destinationIdMap.get(key) for destination name lookups.
   */
  override get(key: string): unknown {
    let value = this.data.get(key);
    if (value === undefined && this.destinationIdMap.has(key)) {
      const metaDataId = this.destinationIdMap.get(key)!;
      value = this.data.get(`d${metaDataId}`);
    }
    return value;
  }

  /**
   * Check if key exists, with fallback to d# lookup via destinationIdMap.
   */
  override containsKey(key: string): boolean {
    if (this.data.has(key)) return true;
    if (this.destinationIdMap.has(key)) {
      const metaDataId = this.destinationIdMap.get(key)!;
      return this.data.has(`d${metaDataId}`);
    }
    return false;
  }

  /**
   * Get destination ID for a destination name
   */
  getDestinationId(destinationName: string): number | undefined {
    return this.destinationIdMap.get(destinationName);
  }

  /**
   * Get all destination IDs
   */
  getDestinationIdMap(): Map<string, number> {
    return this.destinationIdMap;
  }
}

/**
 * GlobalMap - Singleton map for global variables across all channels
 *
 * Supports an optional MapBackend for clustered deployments. When a backend
 * is configured via setBackend(), writes are persisted asynchronously
 * (write-through cache) while reads remain synchronous from the in-memory
 * cache for backward compatibility with user scripts that call $g('key').
 */
export class GlobalMap extends MirthMap {
  private static instance: GlobalMap | null = null;
  private backend: MapBackend | null = null;

  private constructor() {
    super();
  }

  static getInstance(): GlobalMap {
    if (!GlobalMap.instance) {
      GlobalMap.instance = new GlobalMap();
    }
    return GlobalMap.instance;
  }

  /**
   * Set a backend for persistent/shared storage.
   * Activates write-through caching: reads from in-memory, writes to both.
   */
  static setBackend(backend: MapBackend): void {
    GlobalMap.getInstance().backend = backend;
  }

  /**
   * Get the current backend (if any)
   */
  static getBackend(): MapBackend | null {
    return GlobalMap.getInstance().backend;
  }

  /**
   * Load all entries from the backend into the in-memory cache.
   * Call this at startup when using a persistent backend.
   */
  async loadFromBackend(): Promise<void> {
    if (!this.backend) return;
    const entries = await this.backend.getAll();
    for (const [key, value] of entries) {
      this.data.set(key, value);
    }
  }

  /**
   * Put value by key — synchronous in-memory write with async backend persist.
   */
  override put(key: string, value: unknown): unknown {
    const previous = super.put(key, value);
    if (this.backend) {
      // Fire-and-forget write-through to backend
      this.backend.set(key, value).catch((err) => {
        console.error(`[GlobalMap] Backend write failed for key "${key}":`, err);
      });
    }
    return previous;
  }

  /**
   * Remove key — synchronous in-memory delete with async backend delete.
   */
  override remove(key: string): unknown {
    const value = super.remove(key);
    if (this.backend) {
      this.backend.delete(key).catch((err) => {
        console.error(`[GlobalMap] Backend delete failed for key "${key}":`, err);
      });
    }
    return value;
  }

  /**
   * Clear all entries — synchronous in-memory clear with async backend clear.
   */
  override clear(): void {
    super.clear();
    if (this.backend) {
      this.backend.clear().catch((err) => {
        console.error('[GlobalMap] Backend clear failed:', err);
      });
    }
  }

  /**
   * Reset for testing
   */
  static resetInstance(): void {
    GlobalMap.instance = null;
  }
}

/**
 * BackendAwareMirthMap - MirthMap that delegates writes to a MapBackend.
 *
 * Used internally by GlobalChannelMapStore to provide write-through caching
 * per channel when a backend factory is configured.
 */
class BackendAwareMirthMap extends MirthMap {
  private backend: MapBackend;

  constructor(backend: MapBackend) {
    super();
    this.backend = backend;
  }

  override put(key: string, value: unknown): unknown {
    const previous = super.put(key, value);
    this.backend.set(key, value).catch((err) => {
      console.error(`[GlobalChannelMap] Backend write failed for key "${key}":`, err);
    });
    return previous;
  }

  override remove(key: string): unknown {
    const value = super.remove(key);
    this.backend.delete(key).catch((err) => {
      console.error(`[GlobalChannelMap] Backend delete failed for key "${key}":`, err);
    });
    return value;
  }

  override clear(): void {
    super.clear();
    this.backend.clear().catch((err) => {
      console.error('[GlobalChannelMap] Backend clear failed:', err);
    });
  }

  /**
   * Load all entries from the backend into the in-memory cache.
   */
  async loadFromBackend(): Promise<void> {
    const entries = await this.backend.getAll();
    for (const [key, value] of entries) {
      this.data.set(key, value);
    }
  }
}

/**
 * GlobalChannelMap - Per-channel global variables
 *
 * Supports an optional backend factory for clustered deployments.
 * When a factory is set via setBackendFactory(), each per-channel map
 * is backed by a MapBackend instance scoped to that channel.
 */
export class GlobalChannelMapStore {
  private static instance: GlobalChannelMapStore | null = null;
  private channelMaps: Map<string, MirthMap>;
  private backendFactory: ((channelId: string) => MapBackend) | null = null;

  private constructor() {
    this.channelMaps = new Map();
  }

  static getInstance(): GlobalChannelMapStore {
    if (!GlobalChannelMapStore.instance) {
      GlobalChannelMapStore.instance = new GlobalChannelMapStore();
    }
    return GlobalChannelMapStore.instance;
  }

  /**
   * Set a factory that creates a MapBackend for each channel.
   * New channel maps created after this call will be backend-aware.
   */
  static setBackendFactory(factory: (channelId: string) => MapBackend): void {
    GlobalChannelMapStore.getInstance().backendFactory = factory;
  }

  /**
   * Get or create map for channel.
   * If a backend factory is configured, new maps are created with
   * write-through caching to the backend.
   */
  get(channelId: string): MirthMap {
    if (!this.channelMaps.has(channelId)) {
      if (this.backendFactory) {
        const backend = this.backendFactory(channelId);
        this.channelMaps.set(channelId, new BackendAwareMirthMap(backend));
      } else {
        this.channelMaps.set(channelId, new MirthMap());
      }
    }
    return this.channelMaps.get(channelId)!;
  }

  /**
   * Load a channel's map from its backend.
   * No-op if the map is not backend-aware.
   */
  async loadChannelFromBackend(channelId: string): Promise<void> {
    const map = this.get(channelId);
    if (map instanceof BackendAwareMirthMap) {
      await map.loadFromBackend();
    }
  }

  /**
   * Clear map for channel
   */
  clear(channelId: string): void {
    this.channelMaps.delete(channelId);
  }

  /**
   * Clear all channel maps
   */
  clearAll(): void {
    this.channelMaps.clear();
  }

  /**
   * Reset for testing
   */
  static resetInstance(): void {
    GlobalChannelMapStore.instance = null;
  }
}

/**
 * ConfigurationMap - Server configuration map (typically read-only)
 *
 * In clustered mode, configuration can be periodically reloaded from the
 * database so that changes made on one node are visible to others.
 */
export class ConfigurationMap extends MirthMap {
  private static instance: ConfigurationMap | null = null;
  private reloadTimer: ReturnType<typeof setInterval> | null = null;
  private fallback: ((key: string) => unknown | undefined) | null = null;

  private constructor() {
    super();
  }

  static getInstance(): ConfigurationMap {
    if (!ConfigurationMap.instance) {
      ConfigurationMap.instance = new ConfigurationMap();
    }
    return ConfigurationMap.instance;
  }

  /**
   * Load configuration from object
   */
  load(config: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(config)) {
      this.data.set(key, value);
    }
  }

  /**
   * Set a fallback function for keys not found in the database.
   * Used to bridge SecretsManager into $cfg() transparently.
   */
  setFallback(fn: (key: string) => unknown | undefined): void {
    this.fallback = fn;
  }

  /**
   * Override get to check fallback when key not in database.
   * This is what makes $cfg('DB_PASSWORD') resolve from vault.
   */
  override get(key: string): unknown {
    const value = this.data.get(key);
    if (value !== undefined) return value;
    if (this.fallback) return this.fallback(key);
    return undefined;
  }

  /**
   * Reload configuration from CONFIGURATION table.
   * Replaces the in-memory cache with fresh values from the database.
   */
  async reloadFromDb(): Promise<void> {
    // Dynamic import to avoid circular dependency at module load time
    const { getPool } = await import('../../db/pool.js');
    const pool = getPool();
    const [rows] = await pool.query<ConfigurationRow[]>(
      'SELECT NAME, VALUE FROM CONFIGURATION'
    );
    this.data.clear();
    for (const row of rows) {
      this.data.set(row.NAME, row.VALUE);
    }
  }

  /**
   * Start periodic reloading from the database.
   * Useful in clustered mode so configuration changes on one node
   * are picked up by others within the reload interval.
   *
   * @param intervalMs Reload interval in milliseconds (default 30000)
   */
  startPeriodicReload(intervalMs: number = 30_000): void {
    this.stopPeriodicReload();
    this.reloadTimer = setInterval(() => {
      this.reloadFromDb().catch((err) => {
        console.error('[ConfigurationMap] Periodic reload failed:', err);
      });
    }, intervalMs);
    // Don't hold the process open for the timer
    if (this.reloadTimer && typeof this.reloadTimer === 'object' && 'unref' in this.reloadTimer) {
      this.reloadTimer.unref();
    }
  }

  /**
   * Stop periodic reloading.
   */
  stopPeriodicReload(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  /**
   * Reset for testing
   */
  static resetInstance(): void {
    if (ConfigurationMap.instance) {
      ConfigurationMap.instance.stopPeriodicReload();
    }
    ConfigurationMap.instance = null;
  }
}

/**
 * Row interface for CONFIGURATION table queries.
 */
interface ConfigurationRow extends RowDataPacket {
  NAME: string;
  VALUE: string | null;
}
