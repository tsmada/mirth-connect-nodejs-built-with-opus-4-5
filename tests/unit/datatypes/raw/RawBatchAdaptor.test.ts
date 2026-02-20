/**
 * Tests for Raw batch adaptor — validates JavaScript-only batch splitting.
 */

import {
  RawBatchAdaptor,
  RawBatchAdaptorFactory,
  RawSplitType,
  getDefaultRawBatchProperties,
} from '../../../../src/datatypes/raw/RawBatchAdaptor';

describe('RawBatchAdaptor', () => {
  it('should split raw content via script', async () => {
    const messages = ['part1', 'part2'];
    let idx = 0;
    const adaptor = new RawBatchAdaptor(
      'raw data',
      () => idx < messages.length ? messages[idx++]! : null
    );

    expect(await adaptor.getMessage()).toBe('part1');
    expect(await adaptor.getMessage()).toBe('part2');
    expect(await adaptor.getMessage()).toBeNull();
    expect(adaptor.isBatchComplete()).toBe(true);
  });

  it('should track sequence IDs', async () => {
    let count = 0;
    const adaptor = new RawBatchAdaptor('data', () => count++ < 1 ? 'msg' : null);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);
  });
});

describe('RawBatchAdaptorFactory', () => {
  it('should create batch adaptors', async () => {
    let called = false;
    const factory = new RawBatchAdaptorFactory(() => {
      if (!called) { called = true; return 'msg'; }
      return null;
    });

    const adaptor = factory.createBatchAdaptor('input');
    expect(await adaptor.getMessage()).toBe('msg');
    expect(await adaptor.getMessage()).toBeNull();
  });
});

describe('RawBatchProperties', () => {
  it('should have JavaScript as default split type', () => {
    const props = getDefaultRawBatchProperties();
    expect(props.splitType).toBe(RawSplitType.JavaScript);
    expect(props.batchScript).toBe('');
  });
});
