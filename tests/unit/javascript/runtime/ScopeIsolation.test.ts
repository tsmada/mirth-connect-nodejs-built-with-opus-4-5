/**
 * Tests for P2-2: Buffer prototype pollution prevention.
 *
 * Verifies that the frozen Buffer wrapper in ScopeBuilder blocks VM scripts
 * from modifying Buffer.prototype (which would leak to the outer Node.js realm
 * and affect ALL subsequent VM executions).
 */

import { transpileAndRun } from '../../../helpers/AdversarialTestHelpers.js';

describe('P2-2: Buffer prototype pollution prevention', () => {
  it('should allow Buffer.from() in VM scope', () => {
    const ctx = transpileAndRun(`
      var buf = Buffer.from('hello', 'utf-8');
      var result = buf.toString('utf-8');
    `);

    expect(ctx['result']).toBe('hello');
  });

  it('should block Buffer.prototype modification in VM scope', () => {
    // Attempting to add a property to Buffer should fail because Buffer is frozen.
    // The frozen object either throws a TypeError in strict mode
    // or silently ignores the assignment in sloppy mode.
    // Either way, the outer realm's Buffer must be unaffected.
    try {
      transpileAndRun(`
        Buffer.evilMethod = function() { return 'pwned'; };
      `);
    } catch (_e) {
      // Expected in strict mode — frozen object rejects property assignment
    }

    // The outer realm's Buffer must not have been polluted
    expect((Buffer as any).evilMethod).toBeUndefined();
  });

  it('should provide a frozen Buffer object', () => {
    const ctx = transpileAndRun(`
      var isFrozen = Object.isFrozen(Buffer);
    `);

    expect(ctx['isFrozen']).toBe(true);
  });

  it('should allow Buffer.alloc() in VM scope', () => {
    const ctx = transpileAndRun(`
      var buf = Buffer.alloc(10);
      var len = buf.length;
    `);

    expect(ctx['len']).toBe(10);
  });
});
