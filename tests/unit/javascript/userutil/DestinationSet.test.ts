/**
 * Unit tests for DestinationSet userutil class
 */

import {
  DestinationSet,
  createDestinationSet,
  DESTINATION_SET_KEY,
  IConnectorMessage,
} from '../../../../src/javascript/userutil/DestinationSet.js';

describe('DestinationSet', () => {
  // Helper to create a mock connector message
  function createMockConnectorMessage(
    metaDataIds?: number[],
    destinationIdMap?: Map<string, number>
  ): IConnectorMessage {
    const sourceMap = new Map<string, unknown>();
    if (metaDataIds) {
      sourceMap.set(DESTINATION_SET_KEY, new Set(metaDataIds));
    }

    return {
      getSourceMap: () => sourceMap,
      getDestinationIdMap: destinationIdMap ? () => destinationIdMap : undefined,
    };
  }

  describe('constructor', () => {
    it('should initialize with destination set from source map', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3]);
      const destSet = new DestinationSet(connectorMessage);

      expect(destSet.getMetaDataIds()).toEqual(new Set([1, 2, 3]));
    });

    it('should handle missing destination set gracefully', () => {
      const connectorMessage = createMockConnectorMessage();
      const destSet = new DestinationSet(connectorMessage);

      expect(destSet.getMetaDataIds()).toBeNull();
    });

    it('should initialize with destination ID map', () => {
      const destinationIdMap = new Map([
        ['HTTP Sender', 1],
        ['File Writer', 2],
      ]);
      const connectorMessage = createMockConnectorMessage([1, 2], destinationIdMap);
      const destSet = new DestinationSet(connectorMessage);

      expect(destSet.contains('HTTP Sender')).toBe(true);
      expect(destSet.contains('File Writer')).toBe(true);
    });
  });

  describe('remove', () => {
    it('should remove destination by metadata ID', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.remove(2);

      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()).toEqual(new Set([1, 3]));
    });

    it('should remove destination by connector name', () => {
      const destinationIdMap = new Map([
        ['HTTP Sender', 1],
        ['File Writer', 2],
      ]);
      const connectorMessage = createMockConnectorMessage([1, 2], destinationIdMap);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.remove('HTTP Sender');

      expect(removed).toBe(true);
      expect(destSet.contains(1)).toBe(false);
      expect(destSet.contains(2)).toBe(true);
    });

    it('should return false when destination not found', () => {
      const connectorMessage = createMockConnectorMessage([1, 2]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.remove(99);

      expect(removed).toBe(false);
    });

    it('should return false when no destination set exists', () => {
      const connectorMessage = createMockConnectorMessage();
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.remove(1);

      expect(removed).toBe(false);
    });

    it('should convert floating point IDs to integers', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.remove(2.7);

      expect(removed).toBe(true);
      expect(destSet.contains(2)).toBe(false);
    });
  });

  describe('removeMany', () => {
    it('should remove multiple destinations by metadata IDs', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3, 4]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeMany([1, 3]);

      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()).toEqual(new Set([2, 4]));
    });

    it('should remove multiple destinations by names', () => {
      const destinationIdMap = new Map([
        ['A', 1],
        ['B', 2],
        ['C', 3],
      ]);
      const connectorMessage = createMockConnectorMessage([1, 2, 3], destinationIdMap);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeMany(['A', 'C']);

      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()).toEqual(new Set([2]));
    });

    it('should return true if at least one was removed', () => {
      const connectorMessage = createMockConnectorMessage([1, 2]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeMany([1, 99]);

      expect(removed).toBe(true);
    });

    it('should return false if none were removed', () => {
      const connectorMessage = createMockConnectorMessage([1, 2]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeMany([98, 99]);

      expect(removed).toBe(false);
    });
  });

  describe('removeAllExcept', () => {
    it('should keep only specified destination by ID', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3, 4]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAllExcept(2);

      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()).toEqual(new Set([2]));
    });

    it('should keep only specified destination by name', () => {
      const destinationIdMap = new Map([
        ['A', 1],
        ['B', 2],
        ['C', 3],
      ]);
      const connectorMessage = createMockConnectorMessage([1, 2, 3], destinationIdMap);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAllExcept('B');

      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()).toEqual(new Set([2]));
    });

    it('should return false when only keeping one that was already alone', () => {
      const connectorMessage = createMockConnectorMessage([1]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAllExcept(1);

      expect(removed).toBe(false);
    });

    it('should clear set if specified ID not found', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAllExcept(99);

      // Returns true because the set was modified (items were removed)
      // even though the specified ID wasn't in the set
      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()?.size).toBe(0);
    });
  });

  describe('removeAllExceptMany', () => {
    it('should keep only specified destinations', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3, 4, 5]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAllExceptMany([2, 4]);

      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()).toEqual(new Set([2, 4]));
    });

    it('should keep only specified destinations by name', () => {
      const destinationIdMap = new Map([
        ['A', 1],
        ['B', 2],
        ['C', 3],
      ]);
      const connectorMessage = createMockConnectorMessage([1, 2, 3], destinationIdMap);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAllExceptMany(['A', 'C']);

      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()).toEqual(new Set([1, 3]));
    });
  });

  describe('removeAll', () => {
    it('should remove all destinations', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAll();

      expect(removed).toBe(true);
      expect(destSet.getMetaDataIds()?.size).toBe(0);
    });

    it('should return false when already empty', () => {
      const connectorMessage = createMockConnectorMessage([]);
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAll();

      expect(removed).toBe(false);
    });

    it('should return false when no destination set exists', () => {
      const connectorMessage = createMockConnectorMessage();
      const destSet = new DestinationSet(connectorMessage);

      const removed = destSet.removeAll();

      expect(removed).toBe(false);
    });
  });

  describe('contains', () => {
    it('should return true for existing destination by ID', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3]);
      const destSet = new DestinationSet(connectorMessage);

      expect(destSet.contains(2)).toBe(true);
    });

    it('should return false for non-existing destination', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3]);
      const destSet = new DestinationSet(connectorMessage);

      expect(destSet.contains(99)).toBe(false);
    });

    it('should return true for existing destination by name', () => {
      const destinationIdMap = new Map([['TestDest', 1]]);
      const connectorMessage = createMockConnectorMessage([1], destinationIdMap);
      const destSet = new DestinationSet(connectorMessage);

      expect(destSet.contains('TestDest')).toBe(true);
    });
  });

  describe('size', () => {
    it('should return the number of destinations', () => {
      const connectorMessage = createMockConnectorMessage([1, 2, 3]);
      const destSet = new DestinationSet(connectorMessage);

      expect(destSet.size()).toBe(3);
    });

    it('should return 0 when no destination set exists', () => {
      const connectorMessage = createMockConnectorMessage();
      const destSet = new DestinationSet(connectorMessage);

      expect(destSet.size()).toBe(0);
    });
  });
});

describe('createDestinationSet', () => {
  it('should create a destination set and initialize source map', () => {
    const sourceMap = new Map<string, unknown>();
    const connectorMessage: IConnectorMessage = {
      getSourceMap: () => sourceMap,
    };
    const destinationIdMap = new Map([
      ['Dest1', 1],
      ['Dest2', 2],
    ]);

    const destSet = createDestinationSet(connectorMessage, [1, 2, 3], destinationIdMap);

    expect(destSet.getMetaDataIds()).toEqual(new Set([1, 2, 3]));
    expect(sourceMap.get(DESTINATION_SET_KEY)).toEqual(new Set([1, 2, 3]));
    expect(destSet.contains('Dest1')).toBe(true);
  });
});
