/**
 * Unit tests for RawMessage userutil class
 */

import { RawMessage } from '../../../../src/javascript/userutil/RawMessage.js';

describe('RawMessage', () => {
  describe('constructor with string data', () => {
    it('should create RawMessage with string data', () => {
      const rawMessage = new RawMessage('test message');

      expect(rawMessage.getRawData()).toBe('test message');
      expect(rawMessage.isBinary()).toBe(false);
      expect(rawMessage.getRawBytes()).toBeNull();
      expect(rawMessage.getDestinationMetaDataIds()).toBeNull();
      expect(rawMessage.getSourceMap().size).toBe(0);
    });

    it('should create RawMessage with string data and destination IDs', () => {
      const rawMessage = new RawMessage('test message', [1, 2, 3]);

      expect(rawMessage.getRawData()).toBe('test message');
      expect(rawMessage.isBinary()).toBe(false);
      expect(rawMessage.getDestinationMetaDataIds()).toEqual(new Set([1, 2, 3]));
    });

    it('should create RawMessage with string data, destination IDs, and source map', () => {
      const sourceMap = new Map<string, unknown>([
        ['key1', 'value1'],
        ['key2', 42],
      ]);
      const rawMessage = new RawMessage('test message', [1, 2], sourceMap);

      expect(rawMessage.getRawData()).toBe('test message');
      expect(rawMessage.getSourceMap().get('key1')).toBe('value1');
      expect(rawMessage.getSourceMap().get('key2')).toBe(42);
    });

    it('should convert floating point destination IDs to integers', () => {
      const rawMessage = new RawMessage('test', [1.5, 2.9, 3.1]);

      const ids = rawMessage.getDestinationMetaDataIds();
      expect(ids).toEqual(new Set([1, 2, 3]));
    });
  });

  describe('constructor with binary data', () => {
    it('should create RawMessage with binary data', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const rawMessage = new RawMessage(bytes);

      expect(rawMessage.getRawBytes()).toEqual(bytes);
      expect(rawMessage.isBinary()).toBe(true);
      expect(rawMessage.getRawData()).toBe('Hello');
    });

    it('should create RawMessage with binary data and destination IDs', () => {
      const bytes = new Uint8Array([84, 101, 115, 116]); // "Test"
      const rawMessage = new RawMessage(bytes, [1, 2]);

      expect(rawMessage.getRawBytes()).toEqual(bytes);
      expect(rawMessage.isBinary()).toBe(true);
      expect(rawMessage.getDestinationMetaDataIds()).toEqual(new Set([1, 2]));
    });

    it('should create RawMessage with binary data, destination IDs, and source map', () => {
      const bytes = new Uint8Array([68, 97, 116, 97]); // "Data"
      const sourceMap = new Map<string, unknown>([['key', 'value']]);
      const rawMessage = new RawMessage(bytes, [1], sourceMap);

      expect(rawMessage.getRawBytes()).toEqual(bytes);
      expect(rawMessage.isBinary()).toBe(true);
      expect(rawMessage.getSourceMap().get('key')).toBe('value');
    });
  });

  describe('setters', () => {
    it('should set destination metadata IDs', () => {
      const rawMessage = new RawMessage('test');
      expect(rawMessage.getDestinationMetaDataIds()).toBeNull();

      rawMessage.setDestinationMetaDataIds([4, 5, 6]);
      expect(rawMessage.getDestinationMetaDataIds()).toEqual(new Set([4, 5, 6]));
    });

    it('should clear destination metadata IDs when set to null', () => {
      const rawMessage = new RawMessage('test', [1, 2, 3]);
      expect(rawMessage.getDestinationMetaDataIds()).toEqual(new Set([1, 2, 3]));

      rawMessage.setDestinationMetaDataIds(null);
      expect(rawMessage.getDestinationMetaDataIds()).toBeNull();
    });

    it('should set source map', () => {
      const rawMessage = new RawMessage('test');
      const newSourceMap = new Map<string, unknown>([['newKey', 'newValue']]);

      rawMessage.setSourceMap(newSourceMap);
      expect(rawMessage.getSourceMap().get('newKey')).toBe('newValue');
    });
  });

  describe('clearMessage', () => {
    it('should clear text message data', () => {
      const rawMessage = new RawMessage('test message');
      rawMessage.clearMessage();

      expect(rawMessage.getRawData()).toBe('');
      expect(rawMessage.getRawBytes()).toBeNull();
    });

    it('should clear binary message data', () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const rawMessage = new RawMessage(bytes);
      rawMessage.clearMessage();

      expect(rawMessage.getRawData()).toBe('');
      expect(rawMessage.getRawBytes()).toBeNull();
    });
  });

  describe('toModelRawMessage', () => {
    it('should convert to model RawMessage', () => {
      const sourceMap = new Map<string, unknown>([['key', 'value']]);
      const rawMessage = new RawMessage('test', [1, 2], sourceMap);

      const modelMessage = rawMessage.toModelRawMessage();

      expect(modelMessage.getRawData()).toBe('test');
      expect(modelMessage.getDestinationMetaDataIds()).toEqual([1, 2]);
      expect(modelMessage.getSourceMap().get('key')).toBe('value');
    });
  });
});
