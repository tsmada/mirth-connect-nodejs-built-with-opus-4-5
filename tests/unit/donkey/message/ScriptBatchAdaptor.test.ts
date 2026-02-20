/**
 * Tests for ScriptBatchAdaptor — the base class for JavaScript-based batch splitting.
 */

import { ScriptBatchAdaptor, ScriptBatchAdaptorFactory } from '../../../../src/donkey/message/ScriptBatchAdaptor';

describe('ScriptBatchAdaptor', () => {
  describe('basic splitting', () => {
    it('should return messages from script until null', async () => {
      const messages = ['msg1', 'msg2', 'msg3'];
      let idx = 0;
      const adaptor = new ScriptBatchAdaptor(
        'raw content',
        () => idx < messages.length ? messages[idx++]! : null
      );

      expect(await adaptor.getMessage()).toBe('msg1');
      expect(await adaptor.getMessage()).toBe('msg2');
      expect(await adaptor.getMessage()).toBe('msg3');
      expect(await adaptor.getMessage()).toBeNull();
    });

    it('should track batch sequence IDs (1-based)', async () => {
      let count = 0;
      const adaptor = new ScriptBatchAdaptor(
        'data',
        () => count++ < 2 ? `msg${count}` : null
      );

      expect(adaptor.getBatchSequenceId()).toBe(0);
      await adaptor.getMessage();
      expect(adaptor.getBatchSequenceId()).toBe(1);
      await adaptor.getMessage();
      expect(adaptor.getBatchSequenceId()).toBe(2);
    });

    it('should mark batch complete after null return', async () => {
      const adaptor = new ScriptBatchAdaptor('data', () => null);

      expect(adaptor.isBatchComplete()).toBe(false);
      await adaptor.getMessage();
      expect(adaptor.isBatchComplete()).toBe(true);
    });

    it('should treat empty string return as batch complete', async () => {
      const adaptor = new ScriptBatchAdaptor('data', () => '');

      expect(await adaptor.getMessage()).toBeNull();
      expect(adaptor.isBatchComplete()).toBe(true);
    });

    it('should return null after cleanup', async () => {
      let count = 0;
      const adaptor = new ScriptBatchAdaptor('data', () => count++ < 5 ? 'msg' : null);

      await adaptor.getMessage();
      adaptor.cleanup();
      expect(await adaptor.getMessage()).toBeNull();
      expect(adaptor.isBatchComplete()).toBe(true);
      expect(adaptor.getBatchSequenceId()).toBe(0);
    });
  });

  describe('reader interface', () => {
    it('should provide a reader with readLine()', async () => {
      const lines: string[] = [];
      const adaptor = new ScriptBatchAdaptor(
        'line1\nline2\nline3',
        ({ reader }) => {
          const line = reader.readLine();
          if (line !== null) {
            lines.push(line);
            return line;
          }
          return null;
        }
      );

      await adaptor.getMessage(); // line1
      await adaptor.getMessage(); // line2
      await adaptor.getMessage(); // line3
      await adaptor.getMessage(); // null

      expect(lines).toEqual(['line1', 'line2', 'line3']);
    });

    it('should provide a reader with readAll()', async () => {
      let allContent = '';
      const adaptor = new ScriptBatchAdaptor(
        'all content here',
        ({ reader }) => {
          if (!allContent) {
            allContent = reader.readAll();
            return allContent;
          }
          return null;
        }
      );

      expect(await adaptor.getMessage()).toBe('all content here');
      expect(await adaptor.getMessage()).toBeNull();
    });

    it('should provide hasMore() on reader', async () => {
      let checkedHasMore = false;
      const adaptor = new ScriptBatchAdaptor(
        'data',
        ({ reader }) => {
          if (!checkedHasMore) {
            checkedHasMore = true;
            expect(reader.hasMore()).toBe(true);
            return reader.readAll();
          }
          expect(reader.hasMore()).toBe(false);
          return null;
        }
      );

      await adaptor.getMessage();
      await adaptor.getMessage();
    });

    it('should handle \\r\\n line endings', async () => {
      const lines: string[] = [];
      const adaptor = new ScriptBatchAdaptor(
        'line1\r\nline2\r\nline3',
        ({ reader }) => {
          const line = reader.readLine();
          if (line !== null) {
            lines.push(line);
            return line;
          }
          return null;
        }
      );

      while (await adaptor.getMessage()) { /* consume all */ }
      expect(lines).toEqual(['line1', 'line2', 'line3']);
    });
  });

  describe('sourceMap', () => {
    it('should pass sourceMap to script context', async () => {
      const sourceMap = new Map<string, unknown>([['key1', 'val1']]);
      let receivedMap: Map<string, unknown> | null = null;

      const adaptor = new ScriptBatchAdaptor(
        'data',
        ({ sourceMap: sm }) => {
          receivedMap = sm;
          return null;
        },
        sourceMap
      );

      await adaptor.getMessage();
      expect(receivedMap).toEqual(sourceMap);
    });

    it('should default to empty sourceMap', async () => {
      let receivedMap: Map<string, unknown> | null = null;
      const adaptor = new ScriptBatchAdaptor(
        'data',
        ({ sourceMap: sm }) => {
          receivedMap = sm;
          return null;
        }
      );

      await adaptor.getMessage();
      expect(receivedMap).toBeInstanceOf(Map);
      expect(receivedMap!.size).toBe(0);
    });
  });
});

describe('ScriptBatchAdaptorFactory', () => {
  it('should create adaptors from the factory', async () => {
    let callCount = 0;
    const factory = new ScriptBatchAdaptorFactory(() => {
      return callCount++ === 0 ? 'message' : null;
    });

    const adaptor = factory.createBatchAdaptor('raw input');
    expect(await adaptor.getMessage()).toBe('message');
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should pass sourceMap to created adaptors', async () => {
    const sourceMap = new Map([['k', 'v']]);
    let received: Map<string, unknown> | null = null;

    const factory = new ScriptBatchAdaptorFactory(
      ({ sourceMap: sm }) => { received = sm; return null; },
      sourceMap
    );

    const adaptor = factory.createBatchAdaptor('data');
    await adaptor.getMessage();
    expect(received).toEqual(sourceMap);
  });
});
