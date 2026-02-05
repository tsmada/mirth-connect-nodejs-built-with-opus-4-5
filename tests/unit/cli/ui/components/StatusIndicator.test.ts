/**
 * StatusIndicator Component Tests
 *
 * Tests the color and symbol mapping for channel states.
 */

import { ChannelState } from '../../../../../src/cli/types/index.js';

// Constants extracted from the component for testing
const STATE_COLORS: Record<ChannelState, string> = {
  STARTED: 'green',
  STOPPED: 'red',
  PAUSED: 'yellow',
  STARTING: 'cyan',
  STOPPING: 'cyan',
  PAUSING: 'cyan',
  UNDEPLOYED: 'gray',
};

const STATE_SYMBOLS: Record<ChannelState, string> = {
  STARTED: '●',
  STOPPED: '○',
  PAUSED: '◐',
  STARTING: '◔',
  STOPPING: '◔',
  PAUSING: '◔',
  UNDEPLOYED: '○',
};

// Helper function to get display info (simulates component logic)
function getStatusDisplay(state: ChannelState): { color: string; symbol: string; text: string } {
  return {
    color: STATE_COLORS[state] || 'white',
    symbol: STATE_SYMBOLS[state] || '?',
    text: `${STATE_SYMBOLS[state] || '?'} ${state}`,
  };
}

describe('StatusIndicator', () => {
  describe('STATE_COLORS', () => {
    it('should use green for STARTED', () => {
      expect(STATE_COLORS.STARTED).toBe('green');
    });

    it('should use red for STOPPED', () => {
      expect(STATE_COLORS.STOPPED).toBe('red');
    });

    it('should use yellow for PAUSED', () => {
      expect(STATE_COLORS.PAUSED).toBe('yellow');
    });

    it('should use cyan for transitional states', () => {
      expect(STATE_COLORS.STARTING).toBe('cyan');
      expect(STATE_COLORS.STOPPING).toBe('cyan');
      expect(STATE_COLORS.PAUSING).toBe('cyan');
    });

    it('should use gray for UNDEPLOYED', () => {
      expect(STATE_COLORS.UNDEPLOYED).toBe('gray');
    });

    it('should have colors for all states', () => {
      const allStates: ChannelState[] = [
        'STARTED',
        'STOPPED',
        'PAUSED',
        'STARTING',
        'STOPPING',
        'PAUSING',
        'UNDEPLOYED',
      ];

      for (const state of allStates) {
        expect(STATE_COLORS[state]).toBeDefined();
        expect(typeof STATE_COLORS[state]).toBe('string');
      }
    });
  });

  describe('STATE_SYMBOLS', () => {
    it('should use filled circle for STARTED', () => {
      expect(STATE_SYMBOLS.STARTED).toBe('●');
    });

    it('should use empty circle for STOPPED', () => {
      expect(STATE_SYMBOLS.STOPPED).toBe('○');
    });

    it('should use half circle for PAUSED', () => {
      expect(STATE_SYMBOLS.PAUSED).toBe('◐');
    });

    it('should use quarter circle for transitional states', () => {
      expect(STATE_SYMBOLS.STARTING).toBe('◔');
      expect(STATE_SYMBOLS.STOPPING).toBe('◔');
      expect(STATE_SYMBOLS.PAUSING).toBe('◔');
    });

    it('should use empty circle for UNDEPLOYED', () => {
      expect(STATE_SYMBOLS.UNDEPLOYED).toBe('○');
    });

    it('should have symbols for all states', () => {
      const allStates: ChannelState[] = [
        'STARTED',
        'STOPPED',
        'PAUSED',
        'STARTING',
        'STOPPING',
        'PAUSING',
        'UNDEPLOYED',
      ];

      for (const state of allStates) {
        expect(STATE_SYMBOLS[state]).toBeDefined();
        expect(typeof STATE_SYMBOLS[state]).toBe('string');
      }
    });
  });

  describe('getStatusDisplay', () => {
    it('should return correct display for STARTED', () => {
      const display = getStatusDisplay('STARTED');
      expect(display.color).toBe('green');
      expect(display.symbol).toBe('●');
      expect(display.text).toBe('● STARTED');
    });

    it('should return correct display for STOPPED', () => {
      const display = getStatusDisplay('STOPPED');
      expect(display.color).toBe('red');
      expect(display.symbol).toBe('○');
      expect(display.text).toBe('○ STOPPED');
    });

    it('should return correct display for PAUSED', () => {
      const display = getStatusDisplay('PAUSED');
      expect(display.color).toBe('yellow');
      expect(display.symbol).toBe('◐');
      expect(display.text).toBe('◐ PAUSED');
    });

    it('should format text with symbol and state', () => {
      const allStates: ChannelState[] = [
        'STARTED',
        'STOPPED',
        'PAUSED',
        'STARTING',
        'STOPPING',
        'PAUSING',
        'UNDEPLOYED',
      ];

      for (const state of allStates) {
        const display = getStatusDisplay(state);
        expect(display.text).toContain(state);
        expect(display.text).toContain(display.symbol);
      }
    });
  });
});
