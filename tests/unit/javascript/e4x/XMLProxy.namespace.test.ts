/**
 * Tests for P0-1: Per-scope namespace isolation.
 *
 * Verifies that createNamespaceFunctions() factory produces independent
 * namespace state per VM scope, preventing cross-channel pollution where
 * Channel A's `default xml namespace = "urn:hl7-org:v3"` would leak into
 * Channel B's transformer execution.
 */

import { createNamespaceFunctions, setDefaultXmlNamespace, getDefaultXmlNamespace } from '../../../../src/javascript/e4x/XMLProxy.js';
import { transpileAndRun } from '../../../helpers/AdversarialTestHelpers.js';

describe('P0-1: Per-scope namespace isolation', () => {
  it('should create independent namespace state per factory call', () => {
    const scope1 = createNamespaceFunctions();
    const scope2 = createNamespaceFunctions();

    // Set namespace in scope 1
    scope1.setDefaultXmlNamespace('urn:hl7-org:v3');
    expect(scope1.getDefaultXmlNamespace()).toBe('urn:hl7-org:v3');

    // Scope 2 should be unaffected
    expect(scope2.getDefaultXmlNamespace()).toBe('');
  });

  it('should not share state between two scopes', () => {
    const scope1 = createNamespaceFunctions();
    const scope2 = createNamespaceFunctions();

    scope1.setDefaultXmlNamespace('urn:scope1');
    scope2.setDefaultXmlNamespace('urn:scope2');

    // Each scope maintains its own state
    expect(scope1.getDefaultXmlNamespace()).toBe('urn:scope1');
    expect(scope2.getDefaultXmlNamespace()).toBe('urn:scope2');
  });

  it('should reset namespace between independent VM executions', () => {
    // Simulate Channel A setting namespace
    const ctx1 = transpileAndRun(`
      setDefaultXmlNamespace('urn:channel-a');
      var ns1 = getDefaultXmlNamespace();
    `);
    expect(ctx1['ns1']).toBe('urn:channel-a');

    // Simulate Channel B — should start with empty namespace
    const ctx2 = transpileAndRun(`
      var ns2 = getDefaultXmlNamespace();
    `);
    expect(ctx2['ns2']).toBe('');
  });

  it('should persist namespace within a single VM scope execution', () => {
    const ctx = transpileAndRun(`
      setDefaultXmlNamespace('urn:persistent');
      var nsBefore = getDefaultXmlNamespace();

      // Do some other work
      var x = 1 + 1;

      // Namespace should still be set
      var nsAfter = getDefaultXmlNamespace();
    `);

    expect(ctx['nsBefore']).toBe('urn:persistent');
    expect(ctx['nsAfter']).toBe('urn:persistent');
  });

  it('should simulate concurrent channel isolation', () => {
    // Simulate interleaved channel execution (as would happen with parallel messages)
    const ctxA = transpileAndRun(`
      setDefaultXmlNamespace('urn:channel-A');
      var nsA = getDefaultXmlNamespace();
    `);

    const ctxB = transpileAndRun(`
      setDefaultXmlNamespace('urn:channel-B');
      var nsB = getDefaultXmlNamespace();
    `);

    const ctxC = transpileAndRun(`
      // Channel C doesn't set a namespace — should be empty
      var nsC = getDefaultXmlNamespace();
    `);

    expect(ctxA['nsA']).toBe('urn:channel-A');
    expect(ctxB['nsB']).toBe('urn:channel-B');
    expect(ctxC['nsC']).toBe('');
  });

  it('should keep module-level exports for backward compatibility', () => {
    // The module-level setDefaultXmlNamespace/getDefaultXmlNamespace
    // should still exist for direct imports (tests, non-VM code)
    const originalNs = getDefaultXmlNamespace();

    setDefaultXmlNamespace('urn:backward-compat');
    expect(getDefaultXmlNamespace()).toBe('urn:backward-compat');

    // Restore original state
    setDefaultXmlNamespace(originalNs);
    expect(getDefaultXmlNamespace()).toBe(originalNs);
  });
});
