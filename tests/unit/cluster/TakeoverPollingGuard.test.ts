import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  initTakeoverPollingGuard,
  isPollingAllowedInTakeover,
  enableTakeoverPolling,
  disableTakeoverPolling,
  getTakeoverPollingEnabled,
  resetTakeoverPollingGuard,
} from '../../../src/cluster/TakeoverPollingGuard.js';

describe('TakeoverPollingGuard', () => {
  let savedMode: string | undefined;
  let savedPollChannels: string | undefined;

  beforeEach(() => {
    savedMode = process.env['MIRTH_MODE'];
    savedPollChannels = process.env['MIRTH_TAKEOVER_POLL_CHANNELS'];
    delete process.env['MIRTH_MODE'];
    delete process.env['MIRTH_TAKEOVER_POLL_CHANNELS'];
    resetTakeoverPollingGuard();
  });

  afterEach(() => {
    if (savedMode !== undefined) {
      process.env['MIRTH_MODE'] = savedMode;
    } else {
      delete process.env['MIRTH_MODE'];
    }
    if (savedPollChannels !== undefined) {
      process.env['MIRTH_TAKEOVER_POLL_CHANNELS'] = savedPollChannels;
    } else {
      delete process.env['MIRTH_TAKEOVER_POLL_CHANNELS'];
    }
    resetTakeoverPollingGuard();
  });

  describe('not takeover mode', () => {
    it('returns true when MIRTH_MODE is not set', () => {
      expect(isPollingAllowedInTakeover('ch-1')).toBe(true);
    });

    it('returns true when MIRTH_MODE is standalone', () => {
      process.env['MIRTH_MODE'] = 'standalone';
      expect(isPollingAllowedInTakeover('ch-1')).toBe(true);
    });

    it('returns true when MIRTH_MODE is auto', () => {
      process.env['MIRTH_MODE'] = 'auto';
      expect(isPollingAllowedInTakeover('ch-1')).toBe(true);
    });
  });

  describe('takeover mode, no channels enabled', () => {
    beforeEach(() => {
      process.env['MIRTH_MODE'] = 'takeover';
    });

    it('returns false for any channel', () => {
      expect(isPollingAllowedInTakeover('ch-1')).toBe(false);
      expect(isPollingAllowedInTakeover('ch-2')).toBe(false);
      expect(isPollingAllowedInTakeover('any-channel-id')).toBe(false);
    });

    it('returns false even when channelName is provided', () => {
      expect(isPollingAllowedInTakeover('ch-1', 'My Channel')).toBe(false);
    });
  });

  describe('initTakeoverPollingGuard', () => {
    beforeEach(() => {
      process.env['MIRTH_MODE'] = 'takeover';
    });

    it('parses single channel from env var', () => {
      process.env['MIRTH_TAKEOVER_POLL_CHANNELS'] = 'ch-1';
      initTakeoverPollingGuard();
      expect(isPollingAllowedInTakeover('ch-1')).toBe(true);
      expect(isPollingAllowedInTakeover('ch-2')).toBe(false);
    });

    it('parses multiple channels from env var', () => {
      process.env['MIRTH_TAKEOVER_POLL_CHANNELS'] = 'ch-1,ch-2,ch-3';
      initTakeoverPollingGuard();
      expect(isPollingAllowedInTakeover('ch-1')).toBe(true);
      expect(isPollingAllowedInTakeover('ch-2')).toBe(true);
      expect(isPollingAllowedInTakeover('ch-3')).toBe(true);
      expect(isPollingAllowedInTakeover('ch-4')).toBe(false);
    });

    it('trims whitespace around channel entries', () => {
      process.env['MIRTH_TAKEOVER_POLL_CHANNELS'] = ' ch-1 , ch-2 , ch-3 ';
      initTakeoverPollingGuard();
      expect(isPollingAllowedInTakeover('ch-1')).toBe(true);
      expect(isPollingAllowedInTakeover('ch-2')).toBe(true);
      expect(isPollingAllowedInTakeover('ch-3')).toBe(true);
    });

    it('handles empty env var gracefully', () => {
      process.env['MIRTH_TAKEOVER_POLL_CHANNELS'] = '';
      initTakeoverPollingGuard();
      expect(isPollingAllowedInTakeover('ch-1')).toBe(false);
    });

    it('handles whitespace-only env var gracefully', () => {
      process.env['MIRTH_TAKEOVER_POLL_CHANNELS'] = '  , , ,  ';
      initTakeoverPollingGuard();
      expect(getTakeoverPollingEnabled().size).toBe(0);
    });

    it('handles unset env var gracefully', () => {
      initTakeoverPollingGuard();
      expect(getTakeoverPollingEnabled().size).toBe(0);
    });

    it('adds to existing set on re-init (does not replace)', () => {
      enableTakeoverPolling('existing-ch');
      process.env['MIRTH_TAKEOVER_POLL_CHANNELS'] = 'new-ch';
      initTakeoverPollingGuard();
      expect(isPollingAllowedInTakeover('existing-ch')).toBe(true);
      expect(isPollingAllowedInTakeover('new-ch')).toBe(true);
    });
  });

  describe('enableTakeoverPolling / disableTakeoverPolling', () => {
    beforeEach(() => {
      process.env['MIRTH_MODE'] = 'takeover';
    });

    it('enables polling for a channel', () => {
      enableTakeoverPolling('ch-1');
      expect(isPollingAllowedInTakeover('ch-1')).toBe(true);
    });

    it('disables polling for a channel', () => {
      enableTakeoverPolling('ch-1');
      disableTakeoverPolling('ch-1');
      expect(isPollingAllowedInTakeover('ch-1')).toBe(false);
    });

    it('handles disabling a non-enabled channel gracefully', () => {
      disableTakeoverPolling('nonexistent');
      expect(isPollingAllowedInTakeover('nonexistent')).toBe(false);
    });

    it('handles duplicate enables', () => {
      enableTakeoverPolling('ch-1');
      enableTakeoverPolling('ch-1');
      expect(getTakeoverPollingEnabled().size).toBe(1);
    });
  });

  describe('channel name lookup', () => {
    beforeEach(() => {
      process.env['MIRTH_MODE'] = 'takeover';
    });

    it('matches by channelName when channelId does not match', () => {
      enableTakeoverPolling('File Poller');
      expect(isPollingAllowedInTakeover('uuid-123', 'File Poller')).toBe(true);
    });

    it('matches by channelId first', () => {
      enableTakeoverPolling('uuid-123');
      expect(isPollingAllowedInTakeover('uuid-123', 'File Poller')).toBe(true);
    });

    it('returns false when neither channelId nor channelName match', () => {
      enableTakeoverPolling('other-id');
      expect(isPollingAllowedInTakeover('uuid-123', 'File Poller')).toBe(false);
    });

    it('supports channel names from env var', () => {
      process.env['MIRTH_TAKEOVER_POLL_CHANNELS'] = 'File Poller,DB Reader';
      initTakeoverPollingGuard();
      expect(isPollingAllowedInTakeover('uuid-1', 'File Poller')).toBe(true);
      expect(isPollingAllowedInTakeover('uuid-2', 'DB Reader')).toBe(true);
      expect(isPollingAllowedInTakeover('uuid-3', 'HTTP Listener')).toBe(false);
    });
  });

  describe('getTakeoverPollingEnabled', () => {
    it('returns a copy, not the original set', () => {
      enableTakeoverPolling('ch-1');
      const copy = getTakeoverPollingEnabled();
      copy.add('ch-2');
      expect(getTakeoverPollingEnabled().has('ch-2')).toBe(false);
    });

    it('reflects current state', () => {
      enableTakeoverPolling('ch-1');
      enableTakeoverPolling('ch-2');
      const enabled = getTakeoverPollingEnabled();
      expect(enabled.size).toBe(2);
      expect(enabled.has('ch-1')).toBe(true);
      expect(enabled.has('ch-2')).toBe(true);
    });
  });

  describe('resetTakeoverPollingGuard', () => {
    it('clears all state', () => {
      process.env['MIRTH_MODE'] = 'takeover';
      enableTakeoverPolling('ch-1');
      enableTakeoverPolling('ch-2');
      resetTakeoverPollingGuard();
      expect(getTakeoverPollingEnabled().size).toBe(0);
      expect(isPollingAllowedInTakeover('ch-1')).toBe(false);
    });
  });
});
