import {
  StorageSettings,
  MessageStorageMode,
  getStorageSettings,
  parseMessageStorageMode,
} from '../../../../src/donkey/channel/StorageSettings';

describe('StorageSettings', () => {
  describe('defaults', () => {
    it('should default all flags to true/enabled', () => {
      const s = new StorageSettings();
      expect(s.enabled).toBe(true);
      expect(s.durable).toBe(true);
      expect(s.rawDurable).toBe(true);
      expect(s.messageRecoveryEnabled).toBe(true);
      expect(s.storeRaw).toBe(true);
      expect(s.storeProcessedRaw).toBe(true);
      expect(s.storeTransformed).toBe(true);
      expect(s.storeSourceEncoded).toBe(true);
      expect(s.storeDestinationEncoded).toBe(true);
      expect(s.storeResponse).toBe(true);
      expect(s.storeSent).toBe(true);
      expect(s.storeResponseTransformed).toBe(true);
      expect(s.storeProcessedResponse).toBe(true);
      expect(s.storeSentResponse).toBe(true);
      expect(s.storeMaps).toBe(true);
      expect(s.storeResponseMap).toBe(true);
      expect(s.storeMergedResponseMap).toBe(true);
      expect(s.storeAttachments).toBe(true);
      expect(s.storeCustomMetaData).toBe(true);
    });

    it('should default removal flags to false', () => {
      const s = new StorageSettings();
      expect(s.removeContentOnCompletion).toBe(false);
      expect(s.removeOnlyFilteredOnCompletion).toBe(false);
      expect(s.removeAttachmentsOnCompletion).toBe(false);
    });
  });

  describe('getStorageSettings', () => {
    it('DEVELOPMENT mode should keep all flags at defaults', () => {
      const s = getStorageSettings(MessageStorageMode.DEVELOPMENT);
      expect(s.enabled).toBe(true);
      expect(s.storeRaw).toBe(true);
      expect(s.storeProcessedRaw).toBe(true);
      expect(s.storeTransformed).toBe(true);
      expect(s.storeSourceEncoded).toBe(true);
      expect(s.storeDestinationEncoded).toBe(true);
      expect(s.storeSent).toBe(true);
      expect(s.storeResponse).toBe(true);
      expect(s.storeMaps).toBe(true);
    });

    it('PRODUCTION mode should disable intermediate content types', () => {
      const s = getStorageSettings(MessageStorageMode.PRODUCTION);
      expect(s.enabled).toBe(true);
      expect(s.storeRaw).toBe(true);
      // These should be disabled in PRODUCTION
      expect(s.storeProcessedRaw).toBe(false);
      expect(s.storeTransformed).toBe(false);
      expect(s.storeResponseTransformed).toBe(false);
      expect(s.storeProcessedResponse).toBe(false);
      // These should still be enabled
      expect(s.storeSourceEncoded).toBe(true);
      expect(s.storeDestinationEncoded).toBe(true);
      expect(s.storeSent).toBe(true);
      expect(s.storeResponse).toBe(true);
      expect(s.storeMaps).toBe(true);
    });

    it('RAW mode should only store raw content and disable maps/encoded/sent/response', () => {
      const s = getStorageSettings(MessageStorageMode.RAW);
      expect(s.enabled).toBe(true);
      expect(s.storeRaw).toBe(true);
      expect(s.messageRecoveryEnabled).toBe(false);
      expect(s.durable).toBe(false);
      expect(s.storeMaps).toBe(false);
      expect(s.storeResponseMap).toBe(false);
      expect(s.storeMergedResponseMap).toBe(false);
      expect(s.storeProcessedRaw).toBe(false);
      expect(s.storeTransformed).toBe(false);
      expect(s.storeSourceEncoded).toBe(false);
      expect(s.storeDestinationEncoded).toBe(false);
      expect(s.storeSent).toBe(false);
      expect(s.storeResponse).toBe(false);
      expect(s.storeSentResponse).toBe(false);
    });

    it('METADATA mode should disable all content storage', () => {
      const s = getStorageSettings(MessageStorageMode.METADATA);
      expect(s.enabled).toBe(true);
      expect(s.storeRaw).toBe(false);
      expect(s.storeProcessedRaw).toBe(false);
      expect(s.storeTransformed).toBe(false);
      expect(s.storeSourceEncoded).toBe(false);
      expect(s.storeDestinationEncoded).toBe(false);
      expect(s.storeSent).toBe(false);
      expect(s.storeResponse).toBe(false);
      expect(s.storeMaps).toBe(false);
      expect(s.rawDurable).toBe(false);
    });

    it('DISABLED mode should disable everything', () => {
      const s = getStorageSettings(MessageStorageMode.DISABLED);
      expect(s.enabled).toBe(false);
      expect(s.storeRaw).toBe(false);
      expect(s.storeCustomMetaData).toBe(false);
      expect(s.storeMaps).toBe(false);
    });

    it('should apply channel property overrides', () => {
      const s = getStorageSettings(MessageStorageMode.DEVELOPMENT, {
        removeContentOnCompletion: true,
        removeOnlyFilteredOnCompletion: true,
        removeAttachmentsOnCompletion: true,
        storeAttachments: false,
      });
      expect(s.removeContentOnCompletion).toBe(true);
      expect(s.removeOnlyFilteredOnCompletion).toBe(true);
      expect(s.removeAttachmentsOnCompletion).toBe(true);
      expect(s.storeAttachments).toBe(false);
    });
  });

  describe('parseMessageStorageMode', () => {
    it('should parse valid mode strings', () => {
      expect(parseMessageStorageMode('DEVELOPMENT')).toBe(MessageStorageMode.DEVELOPMENT);
      expect(parseMessageStorageMode('PRODUCTION')).toBe(MessageStorageMode.PRODUCTION);
      expect(parseMessageStorageMode('RAW')).toBe(MessageStorageMode.RAW);
      expect(parseMessageStorageMode('METADATA')).toBe(MessageStorageMode.METADATA);
      expect(parseMessageStorageMode('DISABLED')).toBe(MessageStorageMode.DISABLED);
    });

    it('should be case-insensitive', () => {
      expect(parseMessageStorageMode('development')).toBe(MessageStorageMode.DEVELOPMENT);
      expect(parseMessageStorageMode('Production')).toBe(MessageStorageMode.PRODUCTION);
    });

    it('should default to DEVELOPMENT for unknown/undefined', () => {
      expect(parseMessageStorageMode(undefined)).toBe(MessageStorageMode.DEVELOPMENT);
      expect(parseMessageStorageMode('')).toBe(MessageStorageMode.DEVELOPMENT);
      expect(parseMessageStorageMode('BOGUS')).toBe(MessageStorageMode.DEVELOPMENT);
    });
  });

  describe('MessageStorageMode enum values', () => {
    it('should match Java Mirth integer values', () => {
      expect(MessageStorageMode.DISABLED).toBe(1);
      expect(MessageStorageMode.METADATA).toBe(2);
      expect(MessageStorageMode.RAW).toBe(3);
      expect(MessageStorageMode.PRODUCTION).toBe(4);
      expect(MessageStorageMode.DEVELOPMENT).toBe(5);
    });
  });
});
