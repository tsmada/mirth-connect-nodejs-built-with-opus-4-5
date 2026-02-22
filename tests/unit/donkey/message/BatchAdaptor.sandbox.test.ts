/**
 * Tests for batch adaptor sandbox security.
 *
 * Verifies that user-defined batch scripts execute in a vm.createContext() sandbox
 * and cannot access Node.js builtins (require, process, global, etc.).
 */

import { compileBatchScript } from '../../../../src/donkey/message/ScriptBatchAdaptor';
import { HL7BatchAdaptor, HL7v2SplitType } from '../../../../src/donkey/message/HL7BatchAdaptor';
import { DelimitedBatchAdaptor, DelimitedSplitType } from '../../../../src/datatypes/delimited/DelimitedBatchAdaptor';

describe('compileBatchScript sandbox', () => {
  it('should execute normal batch scripts successfully', () => {
    const fn = compileBatchScript('return reader.readLine();');
    const result = fn({
      reader: {
        readLine: () => 'hello',
        readAll: () => '',
        hasMore: () => false,
        close: () => {},
      },
      sourceMap: new Map(),
    });
    expect(result).toBe('hello');
  });

  it('should allow access to reader and sourceMap', () => {
    const fn = compileBatchScript(
      'var key = sourceMap.get("myKey"); return key ? reader.readLine() + "-" + key : null;'
    );
    const result = fn({
      reader: {
        readLine: () => 'msg',
        readAll: () => '',
        hasMore: () => false,
        close: () => {},
      },
      sourceMap: new Map([['myKey', 'val']]),
    });
    expect(result).toBe('msg-val');
  });

  it('should NOT allow access to require()', () => {
    const fn = compileBatchScript('return typeof require;');
    const result = fn({
      reader: { readLine: () => null, readAll: () => '', hasMore: () => false, close: () => {} },
      sourceMap: new Map(),
    });
    expect(result).toBe('undefined');
  });

  it('should NOT allow access to process', () => {
    const fn = compileBatchScript('return typeof process;');
    const result = fn({
      reader: { readLine: () => null, readAll: () => '', hasMore: () => false, close: () => {} },
      sourceMap: new Map(),
    });
    expect(result).toBe('undefined');
  });

  it('should NOT allow access to global', () => {
    const fn = compileBatchScript('return typeof global;');
    const result = fn({
      reader: { readLine: () => null, readAll: () => '', hasMore: () => false, close: () => {} },
      sourceMap: new Map(),
    });
    expect(result).toBe('undefined');
  });

  it('should NOT allow access to globalThis.process', () => {
    const fn = compileBatchScript(
      'try { return String(globalThis.process !== undefined); } catch(e) { return "blocked"; }'
    );
    const result = fn({
      reader: { readLine: () => null, readAll: () => '', hasMore: () => false, close: () => {} },
      sourceMap: new Map(),
    });
    expect(result).toBe('false');
  });

  it('should NOT allow setTimeout/setInterval/setImmediate', () => {
    const fn = compileBatchScript(
      'return [typeof setTimeout, typeof setInterval, typeof setImmediate].join(",");'
    );
    const result = fn({
      reader: { readLine: () => null, readAll: () => '', hasMore: () => false, close: () => {} },
      sourceMap: new Map(),
    });
    expect(result).toBe('undefined,undefined,undefined');
  });

  it('should enforce script timeout for infinite loops', () => {
    // Use a short timeout (100ms) for testing instead of the 30s production default
    const fn = compileBatchScript('while(true) {} return null;', 100);
    expect(() => {
      fn({
        reader: { readLine: () => null, readAll: () => '', hasMore: () => false, close: () => {} },
        sourceMap: new Map(),
      });
    }).toThrow(/timed out/i);
  });

  it('should handle script that returns null', () => {
    const fn = compileBatchScript('return null;');
    const result = fn({
      reader: { readLine: () => null, readAll: () => '', hasMore: () => false, close: () => {} },
      sourceMap: new Map(),
    });
    expect(result).toBeNull();
  });
});

describe('HL7BatchAdaptor JavaScript mode (sandboxed)', () => {
  it('should split using a sandboxed batch script', async () => {
    const rawMessage = 'line1\nline2\nline3';
    const adaptor = new HL7BatchAdaptor(rawMessage, {
      splitType: HL7v2SplitType.JavaScript,
      batchScript: 'return reader.readLine();',
    });

    expect(await adaptor.getMessage()).toBe('line1');
    expect(await adaptor.getMessage()).toBe('line2');
    expect(await adaptor.getMessage()).toBe('line3');
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should prevent require() access in HL7 batch scripts', async () => {
    const adaptor = new HL7BatchAdaptor('data', {
      splitType: HL7v2SplitType.JavaScript,
      batchScript: 'return typeof require;',
    });

    const result = await adaptor.getMessage();
    expect(result).toBe('undefined');
  });

  it('should prevent process access in HL7 batch scripts', async () => {
    const adaptor = new HL7BatchAdaptor('data', {
      splitType: HL7v2SplitType.JavaScript,
      batchScript: 'return typeof process;',
    });

    const result = await adaptor.getMessage();
    expect(result).toBe('undefined');
  });
});

describe('DelimitedBatchAdaptor JavaScript mode (sandboxed)', () => {
  it('should split using a sandboxed batch script', async () => {
    const rawMessage = 'line1\nline2\nline3';
    const adaptor = new DelimitedBatchAdaptor(rawMessage, {
      splitType: DelimitedSplitType.JavaScript,
      recordDelimiter: '\\n',
      columnDelimiter: ',',
      batchScript: 'return reader.readLine();',
    });

    expect(await adaptor.getMessage()).toBe('line1');
    expect(await adaptor.getMessage()).toBe('line2');
    expect(await adaptor.getMessage()).toBe('line3');
    expect(await adaptor.getMessage()).toBeNull();
  });

  it('should prevent require() access in delimited batch scripts', async () => {
    const adaptor = new DelimitedBatchAdaptor('data', {
      splitType: DelimitedSplitType.JavaScript,
      recordDelimiter: '\\n',
      columnDelimiter: ',',
      batchScript: 'return typeof require;',
    });

    const result = await adaptor.getMessage();
    expect(result).toBe('undefined');
  });

  it('should prevent process access in delimited batch scripts', async () => {
    const adaptor = new DelimitedBatchAdaptor('data', {
      splitType: DelimitedSplitType.JavaScript,
      recordDelimiter: '\\n',
      columnDelimiter: ',',
      batchScript: 'return typeof process;',
    });

    const result = await adaptor.getMessage();
    expect(result).toBe('undefined');
  });
});
