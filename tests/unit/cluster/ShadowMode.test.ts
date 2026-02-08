import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  isShadowMode,
  setShadowMode,
  promoteChannel,
  demoteChannel,
  isChannelPromoted,
  promoteAllChannels,
  getPromotedChannels,
  isChannelActive,
  resetShadowMode,
} from '../../../src/cluster/ShadowMode.js';

describe('ShadowMode', () => {
  beforeEach(() => {
    resetShadowMode();
  });

  describe('isShadowMode / setShadowMode', () => {
    it('defaults to false', () => {
      expect(isShadowMode()).toBe(false);
    });

    it('can be enabled', () => {
      setShadowMode(true);
      expect(isShadowMode()).toBe(true);
    });

    it('can be disabled', () => {
      setShadowMode(true);
      setShadowMode(false);
      expect(isShadowMode()).toBe(false);
    });

    it('clears promoted channels when disabled', () => {
      setShadowMode(true);
      promoteChannel('ch-1');
      promoteChannel('ch-2');
      expect(getPromotedChannels().size).toBe(2);
      setShadowMode(false);
      expect(getPromotedChannels().size).toBe(0);
    });
  });

  describe('promoteChannel / demoteChannel', () => {
    it('promotes a channel', () => {
      setShadowMode(true);
      promoteChannel('ch-1');
      expect(isChannelPromoted('ch-1')).toBe(true);
    });

    it('demotes a channel', () => {
      setShadowMode(true);
      promoteChannel('ch-1');
      demoteChannel('ch-1');
      expect(isChannelPromoted('ch-1')).toBe(false);
    });

    it('handles demoting a non-promoted channel gracefully', () => {
      demoteChannel('nonexistent');
      expect(isChannelPromoted('nonexistent')).toBe(false);
    });

    it('handles duplicate promotes', () => {
      promoteChannel('ch-1');
      promoteChannel('ch-1');
      expect(getPromotedChannels().size).toBe(1);
    });
  });

  describe('promoteAllChannels', () => {
    it('disables shadow mode and clears promoted set', () => {
      setShadowMode(true);
      promoteChannel('ch-1');
      promoteChannel('ch-2');
      promoteAllChannels();
      expect(isShadowMode()).toBe(false);
      expect(getPromotedChannels().size).toBe(0);
    });
  });

  describe('isChannelActive', () => {
    it('returns true when shadow mode is off', () => {
      expect(isChannelActive('any-channel')).toBe(true);
    });

    it('returns false for non-promoted channel in shadow mode', () => {
      setShadowMode(true);
      expect(isChannelActive('ch-1')).toBe(false);
    });

    it('returns true for promoted channel in shadow mode', () => {
      setShadowMode(true);
      promoteChannel('ch-1');
      expect(isChannelActive('ch-1')).toBe(true);
    });

    it('returns true for all channels after promoteAll', () => {
      setShadowMode(true);
      promoteAllChannels();
      expect(isChannelActive('any-channel')).toBe(true);
    });
  });

  describe('getPromotedChannels', () => {
    it('returns a copy, not the original set', () => {
      promoteChannel('ch-1');
      const copy = getPromotedChannels();
      copy.add('ch-2');
      expect(isChannelPromoted('ch-2')).toBe(false);
    });
  });

  describe('resetShadowMode', () => {
    it('resets all state', () => {
      setShadowMode(true);
      promoteChannel('ch-1');
      resetShadowMode();
      expect(isShadowMode()).toBe(false);
      expect(getPromotedChannels().size).toBe(0);
    });
  });
});
