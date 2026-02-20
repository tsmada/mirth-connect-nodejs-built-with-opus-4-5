/**
 * Tests for JSON batch adaptor — validates JavaScript-only batch splitting.
 */

import {
  JSONBatchAdaptor,
  JSONBatchAdaptorFactory,
  JSONSplitType,
  getDefaultJSONBatchProperties,
} from '../../../../src/datatypes/json/JSONBatchAdaptor';

describe('JSONBatchAdaptor', () => {
  it('should split JSON array content via script', async () => {
    const jsonArray = '[{"id":1},{"id":2},{"id":3}]';
    const parsed = JSON.parse(jsonArray) as Array<{ id: number }>;
    let idx = 0;

    const adaptor = new JSONBatchAdaptor(
      jsonArray,
      () => idx < parsed.length ? JSON.stringify(parsed[idx++]) : null
    );

    expect(await adaptor.getMessage()).toBe('{"id":1}');
    expect(await adaptor.getMessage()).toBe('{"id":2}');
    expect(await adaptor.getMessage()).toBe('{"id":3}');
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should use reader to access raw content', async () => {
    let readContent = '';
    const adaptor = new JSONBatchAdaptor(
      '{"batch": true}',
      ({ reader }) => {
        if (!readContent) {
          readContent = reader.readAll();
          return readContent;
        }
        return null;
      }
    );

    expect(await adaptor.getMessage()).toBe('{"batch": true}');
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should track sequence IDs', async () => {
    let count = 0;
    const adaptor = new JSONBatchAdaptor('data', () => count++ < 2 ? 'msg' : null);

    expect(adaptor.getBatchSequenceId()).toBe(0);
    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);
    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(2);
  });
});

describe('JSONBatchAdaptorFactory', () => {
  it('should create batch adaptors', async () => {
    let called = false;
    const factory = new JSONBatchAdaptorFactory(() => {
      if (!called) { called = true; return '{"ok":true}'; }
      return null;
    });

    const adaptor = factory.createBatchAdaptor('[{"ok":true}]');
    expect(await adaptor.getMessage()).toBe('{"ok":true}');
    expect(await adaptor.getMessage()).toBeNull();
  });
});

describe('JSONBatchProperties', () => {
  it('should have JavaScript as default split type', () => {
    const props = getDefaultJSONBatchProperties();
    expect(props.splitType).toBe(JSONSplitType.JavaScript);
    expect(props.batchScript).toBe('');
  });
});
