/**
 * Tests for NCPDP batch adaptor — validates JavaScript-only batch splitting.
 */

import {
  NCPDPBatchAdaptor,
  NCPDPBatchAdaptorFactory,
  NCPDPSplitType,
  getDefaultNCPDPBatchProperties,
} from '../../../../src/datatypes/ncpdp/NCPDPBatchAdaptor';

describe('NCPDPBatchAdaptor', () => {
  it('should split NCPDP claims via script', async () => {
    const claims = ['CLAIM001', 'CLAIM002'];
    let idx = 0;

    const adaptor = new NCPDPBatchAdaptor(
      'CLAIM001\x1ECLAIM002',
      () => idx < claims.length ? claims[idx++]! : null
    );

    expect(await adaptor.getMessage()).toBe('CLAIM001');
    expect(await adaptor.getMessage()).toBe('CLAIM002');
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should use reader to split on group separator', async () => {
    const raw = 'CLAIM_A\x1ECLAIM_B';
    const adaptor = new NCPDPBatchAdaptor(
      raw,
      ({ reader }) => {
        const all = reader.readAll();
        if (!all) return null;
        // Simple split by group separator (0x1E)
        const parts = all.split('\x1E');
        return parts.length > 0 ? parts.shift()! : null;
      }
    );

    // First call reads all and returns first part
    expect(await adaptor.getMessage()).toBe('CLAIM_A');
    // Script doesn't maintain state across calls — this is expected
    // Real batch scripts use reader.readLine() iteratively
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should support sourceMap', async () => {
    const sourceMap = new Map([['batchId', '12345']]);
    let receivedBatchId: unknown = null;

    const adaptor = new NCPDPBatchAdaptor(
      'data',
      ({ sourceMap: sm }) => {
        receivedBatchId = sm.get('batchId');
        return null;
      },
      sourceMap
    );

    await adaptor.getMessage();
    expect(receivedBatchId).toBe('12345');
  });

  it('should cleanup properly', async () => {
    let count = 0;
    const adaptor = new NCPDPBatchAdaptor('data', () => count++ < 10 ? 'msg' : null);

    await adaptor.getMessage();
    adaptor.cleanup();
    expect(adaptor.isBatchComplete()).toBe(true);
    expect(await adaptor.getMessage()).toBeNull();
  });
});

describe('NCPDPBatchAdaptorFactory', () => {
  it('should create batch adaptors', async () => {
    let called = false;
    const factory = new NCPDPBatchAdaptorFactory(() => {
      if (!called) { called = true; return 'claim'; }
      return null;
    });

    const adaptor = factory.createBatchAdaptor('raw claims');
    expect(await adaptor.getMessage()).toBe('claim');
    expect(await adaptor.getMessage()).toBeNull();
  });
});

describe('NCPDPBatchProperties', () => {
  it('should have JavaScript as default split type', () => {
    const props = getDefaultNCPDPBatchProperties();
    expect(props.splitType).toBe(NCPDPSplitType.JavaScript);
    expect(props.batchScript).toBe('');
  });
});
