/**
 * Takeover Polling Guard
 *
 * In takeover mode (MIRTH_MODE=takeover), polling source connectors are
 * blocked by default to prevent competition with Java Mirth's pollers.
 * Channels must be explicitly enabled for polling via:
 *   - MIRTH_TAKEOVER_POLL_CHANNELS env var (comma-separated channel IDs or names)
 *   - POST /api/system/polling/enable API endpoint
 *   - mirth-cli polling enable <channel> CLI command
 *
 * Non-polling connectors (HTTP, TCP, JMS queues, VM) are NOT affected.
 */

const pollingEnabledChannels = new Set<string>();

/** Initialize from MIRTH_TAKEOVER_POLL_CHANNELS env var */
export function initTakeoverPollingGuard(): void {
  const envChannels = process.env['MIRTH_TAKEOVER_POLL_CHANNELS'];
  if (envChannels) {
    for (const ch of envChannels.split(',').map(s => s.trim()).filter(Boolean)) {
      pollingEnabledChannels.add(ch);
    }
  }
}

/** Check if polling is allowed for a channel in takeover mode */
export function isPollingAllowedInTakeover(channelId: string, channelName?: string): boolean {
  if (!isTakeoverMode()) return true;
  if (pollingEnabledChannels.has(channelId)) return true;
  if (channelName && pollingEnabledChannels.has(channelName)) return true;
  return false;
}

/** Enable polling for a channel (after stopping on Java side) */
export function enableTakeoverPolling(channelId: string): void {
  pollingEnabledChannels.add(channelId);
}

/** Disable polling for a channel (hand back to Java side) */
export function disableTakeoverPolling(channelId: string): void {
  pollingEnabledChannels.delete(channelId);
}

/** Get all enabled channel IDs/names */
export function getTakeoverPollingEnabled(): Set<string> {
  return new Set(pollingEnabledChannels);
}

/** Check if running in takeover mode */
function isTakeoverMode(): boolean {
  return process.env['MIRTH_MODE'] === 'takeover';
}

/** Reset (for testing) */
export function resetTakeoverPollingGuard(): void {
  pollingEnabledChannels.clear();
}
