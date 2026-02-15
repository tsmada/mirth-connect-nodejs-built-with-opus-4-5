/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/DestinationSet.java
 *
 * Purpose: Utility class used in the preprocessor or source filter/transformer to prevent the
 * message from being sent to specific destinations.
 *
 * Key behaviors to replicate:
 * - Remove destinations by metaDataId or connector name
 * - Remove multiple destinations at once
 * - Remove all except specified destinations
 * - Handle JavaScript numbers (doubles) correctly
 */

/** Key used in sourceMap to store the destination set */
export const DESTINATION_SET_KEY = 'mirth_destination_set';

/**
 * Interface for connector message data needed by DestinationSet
 */
export interface IConnectorMessage {
  getSourceMap(): Map<string, unknown>;
  getDestinationIdMap?(): Map<string, number>;
}

/**
 * Utility class used in the preprocessor or source filter/transformer to prevent the message from
 * being sent to specific destinations.
 */
export class DestinationSet {
  private destinationIdMap: Map<string, number> | null = null;
  private metaDataIds: Set<number> | null = null;

  /**
   * DestinationSet instances should NOT be constructed manually. The instance "destinationSet"
   * provided in the scope should be used.
   *
   * @param connectorMessage The delegate ImmutableConnectorMessage object.
   */
  constructor(connectorMessage: IConnectorMessage) {
    try {
      const sourceMap = connectorMessage.getSourceMap();
      if (sourceMap.has(DESTINATION_SET_KEY)) {
        if (connectorMessage.getDestinationIdMap) {
          this.destinationIdMap = connectorMessage.getDestinationIdMap();
        }
        this.metaDataIds = sourceMap.get(DESTINATION_SET_KEY) as Set<number>;
      }
    } catch {
      // Silently ignore errors (matching Java behavior)
    }
  }

  /**
   * Stop a destination from being processed for this message.
   *
   * @param metaDataIdOrConnectorName An integer representing the metaDataId of a destination
   *        connector, or the actual destination connector name.
   * @return A boolean indicating whether at least one destination connector was actually removed
   *         from processing for this message.
   */
  remove(metaDataIdOrConnectorName: number | string | Iterable<number | string>): boolean {
    // Java has overloaded remove(String), remove(Integer), remove(Collection<?>)
    // JavaScript must dispatch based on argument type at runtime
    if (Array.isArray(metaDataIdOrConnectorName) || (metaDataIdOrConnectorName != null && typeof metaDataIdOrConnectorName === 'object' && Symbol.iterator in metaDataIdOrConnectorName)) {
      return this.removeMany(metaDataIdOrConnectorName as Iterable<number | string>);
    }

    if (this.metaDataIds !== null) {
      const metaDataId = this.convertToMetaDataId(metaDataIdOrConnectorName);

      if (metaDataId !== null) {
        return this.metaDataIds.delete(metaDataId);
      }
    }

    return false;
  }

  /**
   * Stop multiple destinations from being processed for this message.
   *
   * @param metaDataIdOrConnectorNames A collection of integers representing the metaDataId of
   *        destination connectors, or the actual destination connector names.
   * @return A boolean indicating whether at least one destination connector was actually removed
   *         from processing for this message.
   */
  removeMany(metaDataIdOrConnectorNames: Iterable<number | string>): boolean {
    let removed = false;

    for (const metaDataIdOrConnectorName of metaDataIdOrConnectorNames) {
      if (this.remove(metaDataIdOrConnectorName)) {
        removed = true;
      }
    }

    return removed;
  }

  /**
   * Stop all except one destination from being processed for this message.
   *
   * @param metaDataIdOrConnectorName An integer representing the metaDataId of a destination
   *        connector, or the actual destination connector name.
   * @return A boolean indicating whether at least one destination connector was actually removed
   *         from processing for this message.
   */
  removeAllExcept(metaDataIdOrConnectorName: number | string | Iterable<number | string>): boolean {
    // Java has overloaded removeAllExcept(String), removeAllExcept(Integer), removeAllExcept(Collection<?>)
    if (Array.isArray(metaDataIdOrConnectorName) || (metaDataIdOrConnectorName != null && typeof metaDataIdOrConnectorName === 'object' && Symbol.iterator in metaDataIdOrConnectorName)) {
      return this.removeAllExceptMany(metaDataIdOrConnectorName as Iterable<number | string>);
    }

    if (this.metaDataIds !== null) {
      const metaDataId = this.convertToMetaDataId(metaDataIdOrConnectorName);

      if (metaDataId !== null) {
        const originalSize = this.metaDataIds.size;
        const keepId = metaDataId;
        const hadId = this.metaDataIds.has(keepId);

        this.metaDataIds.clear();
        if (hadId) {
          this.metaDataIds.add(keepId);
        }

        // Return true if the set changed
        return this.metaDataIds.size !== originalSize;
      }
    }

    return false;
  }

  /**
   * Stop all except specified destinations from being processed for this message.
   *
   * @param metaDataIdOrConnectorNames A collection of integers representing the metaDataId of
   *        destination connectors, or the actual destination connector names.
   * @return A boolean indicating whether at least one destination connector was actually removed
   *         from processing for this message.
   */
  removeAllExceptMany(metaDataIdOrConnectorNames: Iterable<number | string>): boolean {
    if (this.metaDataIds !== null) {
      const keepSet = new Set<number>();

      for (const metaDataIdOrConnectorName of metaDataIdOrConnectorNames) {
        const metaDataId = this.convertToMetaDataId(metaDataIdOrConnectorName);

        if (metaDataId !== null) {
          keepSet.add(metaDataId);
        }
      }

      const originalSize = this.metaDataIds.size;

      // Retain only the IDs in keepSet
      for (const id of Array.from(this.metaDataIds)) {
        if (!keepSet.has(id)) {
          this.metaDataIds.delete(id);
        }
      }

      // Return true if the set changed
      return this.metaDataIds.size !== originalSize;
    }

    return false;
  }

  /**
   * Stop all destinations from being processed for this message. This does NOT mark the source
   * message as FILTERED.
   *
   * @return A boolean indicating whether at least one destination connector was actually removed
   *         from processing for this message.
   */
  removeAll(): boolean {
    if (this.metaDataIds !== null && this.metaDataIds.size > 0) {
      this.metaDataIds.clear();
      return true;
    }

    return false;
  }

  /**
   * Get the current set of destination metadata IDs.
   * Note: This method is an extension to the Java API for inspection purposes.
   */
  getMetaDataIds(): Set<number> | null {
    return this.metaDataIds;
  }

  /**
   * Check if the destination set contains a specific destination.
   * Note: This method is an extension to the Java API.
   *
   * @param metaDataIdOrConnectorName The metadata ID or connector name to check.
   * @return True if the destination is in the set, false otherwise.
   */
  contains(metaDataIdOrConnectorName: number | string): boolean {
    if (this.metaDataIds === null) {
      return false;
    }

    const metaDataId = this.convertToMetaDataId(metaDataIdOrConnectorName);
    return metaDataId !== null && this.metaDataIds.has(metaDataId);
  }

  /**
   * Get the number of destinations in the set.
   * Note: This method is an extension to the Java API.
   */
  size(): number {
    return this.metaDataIds?.size ?? 0;
  }

  /**
   * Convert a metadata ID or connector name to a metadata ID number.
   */
  private convertToMetaDataId(metaDataIdOrConnectorName: number | string): number | null {
    if (metaDataIdOrConnectorName == null) {
      return null;
    }

    if (typeof metaDataIdOrConnectorName === 'number') {
      // Convert to integer (handles JavaScript doubles)
      return Math.floor(metaDataIdOrConnectorName);
    } else if (this.destinationIdMap !== null) {
      // Look up by connector name
      const id = this.destinationIdMap.get(metaDataIdOrConnectorName);
      return id ?? null;
    }

    return null;
  }
}

/**
 * Create a DestinationSet instance for use in scripts.
 * This should be called with the connector message to create the initial destination set.
 *
 * @param connectorMessage The connector message to create the destination set for.
 * @param destinationIds The initial set of destination metadata IDs.
 * @param destinationIdMap A map of connector names to metadata IDs.
 */
export function createDestinationSet(
  connectorMessage: IConnectorMessage,
  destinationIds: number[],
  destinationIdMap?: Map<string, number>
): DestinationSet {
  // Initialize the destination set in the source map
  const sourceMap = connectorMessage.getSourceMap();
  const metaDataIds = new Set<number>(destinationIds);
  sourceMap.set(DESTINATION_SET_KEY, metaDataIds);

  // Create a wrapper that has getDestinationIdMap
  const wrapper: IConnectorMessage = {
    getSourceMap: () => sourceMap,
    getDestinationIdMap: destinationIdMap ? () => destinationIdMap : undefined,
  };

  return new DestinationSet(wrapper);
}
