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
   * SourceMap.put logs a warning but still allows the put (matching Java behavior)
   */
  override put(key: string, value: unknown): unknown {
    // In Java, this logs a warning but still allows the operation
    // We replicate that behavior here
    console.warn(
      `Warning: Modifying sourceMap directly. Key: ${key}. ` +
        `Consider using channelMap instead for better clarity.`
    );
    return super.put(key, value);
  }
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
   * Get with fallback to sourceMap if not found in channelMap
   */
  override get(key: string): unknown {
    if (this.data.has(key)) {
      return this.data.get(key);
    }
    return this.sourceMap.get(key);
  }

  /**
   * Check both channelMap and sourceMap
   */
  override containsKey(key: string): boolean {
    return this.data.has(key) || this.sourceMap.containsKey(key);
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
 */
export class GlobalMap extends MirthMap {
  private static instance: GlobalMap | null = null;

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
   * Reset for testing
   */
  static resetInstance(): void {
    GlobalMap.instance = null;
  }
}

/**
 * GlobalChannelMap - Per-channel global variables
 */
export class GlobalChannelMapStore {
  private static instance: GlobalChannelMapStore | null = null;
  private channelMaps: Map<string, MirthMap>;

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
   * Get or create map for channel
   */
  get(channelId: string): MirthMap {
    if (!this.channelMaps.has(channelId)) {
      this.channelMaps.set(channelId, new MirthMap());
    }
    return this.channelMaps.get(channelId)!;
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
 */
export class ConfigurationMap extends MirthMap {
  private static instance: ConfigurationMap | null = null;

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
   * Reset for testing
   */
  static resetInstance(): void {
    ConfigurationMap.instance = null;
  }
}
