import { RawMessage } from '../../../src/model/RawMessage';

describe('RawMessage', () => {
  describe('constructor', () => {
    it('should create a raw message with required fields', () => {
      const message = new RawMessage({ rawData: 'test data' });

      expect(message.getRawData()).toBe('test data');
      expect(message.isBinary()).toBe(false);
      expect(message.isOverwrite()).toBe(false);
      expect(message.isImported()).toBe(false);
    });

    it('should create a raw message with all optional fields', () => {
      const sourceMap = new Map<string, unknown>();
      sourceMap.set('key', 'value');

      const message = new RawMessage({
        rawData: 'test data',
        rawBytes: Buffer.from('test data'),
        destinationMetaDataIds: [1, 2],
        sourceMap,
        binary: true,
        overwrite: true,
        imported: true,
        originalMessageId: 100,
      });

      expect(message.getRawData()).toBe('test data');
      expect(message.getRawBytes()?.toString()).toBe('test data');
      expect(message.getDestinationMetaDataIds()).toEqual([1, 2]);
      expect(message.getSourceMap().get('key')).toBe('value');
      expect(message.isBinary()).toBe(true);
      expect(message.isOverwrite()).toBe(true);
      expect(message.isImported()).toBe(true);
      expect(message.getOriginalMessageId()).toBe(100);
    });
  });

  describe('fromString', () => {
    it('should create a text raw message', () => {
      const message = RawMessage.fromString('MSH|^~\\&|...');

      expect(message.getRawData()).toBe('MSH|^~\\&|...');
      expect(message.isBinary()).toBe(false);
    });
  });

  describe('fromBytes', () => {
    it('should create a binary raw message', () => {
      const bytes = Buffer.from([0x0b, 0x4d, 0x53, 0x48]); // Start block + MSH
      const message = RawMessage.fromBytes(bytes);

      expect(message.getRawBytes()).toEqual(bytes);
      expect(message.isBinary()).toBe(true);
    });
  });

  describe('clearMessage', () => {
    it('should clear raw data and bytes', () => {
      const message = new RawMessage({
        rawData: 'test data',
        rawBytes: Buffer.from('test data'),
      });

      message.clearMessage();

      expect(message.getRawData()).toBe('');
      expect(message.getRawBytes()).toBeUndefined();
    });
  });

  describe('sourceMap', () => {
    it('should provide empty source map by default', () => {
      const message = new RawMessage({ rawData: 'test' });
      expect(message.getSourceMap().size).toBe(0);
    });

    it('should allow adding to source map', () => {
      const message = new RawMessage({ rawData: 'test' });
      message.getSourceMap().set('filename', 'test.txt');
      expect(message.getSourceMap().get('filename')).toBe('test.txt');
    });
  });
});
