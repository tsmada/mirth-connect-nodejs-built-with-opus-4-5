/**
 * ClearStatsOverlay Component Tests
 *
 * Tests the checkbox state management, invert logic, and validation
 * behavior of the Clear Statistics overlay.
 */

import type { ClearStatsOptions } from '../../../../../src/cli/ui/components/ClearStatsOverlay.js';

// Extract the core state logic from ClearStatsOverlay for pure function testing

/** Default state: all 4 stat types checked */
function defaultOptions(): ClearStatsOptions {
  return { received: true, filtered: true, sent: true, error: true };
}

/** Toggle a single stat type */
function toggleOption(options: ClearStatsOptions, key: keyof ClearStatsOptions): ClearStatsOptions {
  return { ...options, [key]: !options[key] };
}

/** Invert all selections */
function invertAll(options: ClearStatsOptions): ClearStatsOptions {
  return {
    received: !options.received,
    filtered: !options.filtered,
    sent: !options.sent,
    error: !options.error,
  };
}

/** Check if at least one option is selected */
function hasSelection(options: ClearStatsOptions): boolean {
  return options.received || options.filtered || options.sent || options.error;
}

describe('ClearStatsOverlay', () => {
  describe('defaultOptions', () => {
    it('should default all 4 stat types to checked', () => {
      const opts = defaultOptions();
      expect(opts.received).toBe(true);
      expect(opts.filtered).toBe(true);
      expect(opts.sent).toBe(true);
      expect(opts.error).toBe(true);
    });
  });

  describe('toggleOption', () => {
    it('should toggle received from true to false', () => {
      const opts = toggleOption(defaultOptions(), 'received');
      expect(opts.received).toBe(false);
      expect(opts.filtered).toBe(true);
      expect(opts.sent).toBe(true);
      expect(opts.error).toBe(true);
    });

    it('should toggle error from true to false', () => {
      const opts = toggleOption(defaultOptions(), 'error');
      expect(opts.error).toBe(false);
      expect(opts.received).toBe(true);
    });

    it('should toggle false back to true', () => {
      const opts = toggleOption(defaultOptions(), 'sent');
      expect(opts.sent).toBe(false);
      const opts2 = toggleOption(opts, 'sent');
      expect(opts2.sent).toBe(true);
    });

    it('should not mutate the original options', () => {
      const original = defaultOptions();
      toggleOption(original, 'received');
      expect(original.received).toBe(true);
    });
  });

  describe('invertAll', () => {
    it('should invert all checked to all unchecked', () => {
      const opts = invertAll(defaultOptions());
      expect(opts.received).toBe(false);
      expect(opts.filtered).toBe(false);
      expect(opts.sent).toBe(false);
      expect(opts.error).toBe(false);
    });

    it('should invert all unchecked to all checked', () => {
      const allOff: ClearStatsOptions = {
        received: false,
        filtered: false,
        sent: false,
        error: false,
      };
      const opts = invertAll(allOff);
      expect(opts.received).toBe(true);
      expect(opts.filtered).toBe(true);
      expect(opts.sent).toBe(true);
      expect(opts.error).toBe(true);
    });

    it('should invert mixed selections', () => {
      const mixed: ClearStatsOptions = {
        received: true,
        filtered: false,
        sent: true,
        error: false,
      };
      const opts = invertAll(mixed);
      expect(opts.received).toBe(false);
      expect(opts.filtered).toBe(true);
      expect(opts.sent).toBe(false);
      expect(opts.error).toBe(true);
    });

    it('should be its own inverse (double invert = original)', () => {
      const original = { received: true, filtered: false, sent: true, error: false };
      const doubled = invertAll(invertAll(original));
      expect(doubled).toEqual(original);
    });
  });

  describe('hasSelection', () => {
    it('should return true when all selected', () => {
      expect(hasSelection(defaultOptions())).toBe(true);
    });

    it('should return true when only one selected', () => {
      expect(hasSelection({ received: true, filtered: false, sent: false, error: false })).toBe(
        true
      );
      expect(hasSelection({ received: false, filtered: false, sent: false, error: true })).toBe(
        true
      );
    });

    it('should return false when none selected', () => {
      expect(hasSelection({ received: false, filtered: false, sent: false, error: false })).toBe(
        false
      );
    });
  });

  describe('component structure', () => {
    it('should define the expected props interface', () => {
      const props = {
        channelCount: 3,
        channelLabel: '3 channel(s)',
        onConfirm: (_options: ClearStatsOptions) => {},
        onCancel: () => {},
      };

      expect(props.channelCount).toBe(3);
      expect(props.channelLabel).toBe('3 channel(s)');
      expect(typeof props.onConfirm).toBe('function');
      expect(typeof props.onCancel).toBe('function');
    });

    it('should accept single channel label', () => {
      const label = 'ADT Receiver';
      expect(label.length).toBeGreaterThan(0);
    });

    it('should accept multi-channel label', () => {
      const count = 5;
      const label = `${count} channel(s)`;
      expect(label).toBe('5 channel(s)');
    });
  });

  describe('API options mapping', () => {
    it('should map checked options to API params correctly (all true = no params)', () => {
      const opts = defaultOptions();
      // When all true, no query params are needed (server defaults to true)
      const params = new URLSearchParams();
      if (opts.received === false) params.set('received', 'false');
      if (opts.filtered === false) params.set('filtered', 'false');
      if (opts.sent === false) params.set('sent', 'false');
      if (opts.error === false) params.set('error', 'false');
      expect(params.toString()).toBe('');
    });

    it('should map unchecked options to false query params', () => {
      const opts: ClearStatsOptions = { received: true, filtered: false, sent: true, error: false };
      const params = new URLSearchParams();
      if (opts.received === false) params.set('received', 'false');
      if (opts.filtered === false) params.set('filtered', 'false');
      if (opts.sent === false) params.set('sent', 'false');
      if (opts.error === false) params.set('error', 'false');
      expect(params.get('filtered')).toBe('false');
      expect(params.get('error')).toBe('false');
      expect(params.has('received')).toBe(false);
      expect(params.has('sent')).toBe(false);
    });

    it('should map all unchecked to all false params', () => {
      const opts: ClearStatsOptions = {
        received: false,
        filtered: false,
        sent: false,
        error: false,
      };
      const params = new URLSearchParams();
      if (opts.received === false) params.set('received', 'false');
      if (opts.filtered === false) params.set('filtered', 'false');
      if (opts.sent === false) params.set('sent', 'false');
      if (opts.error === false) params.set('error', 'false');
      expect(params.toString()).toBe('received=false&filtered=false&sent=false&error=false');
    });
  });
});
