/**
 * Shadow Mode State Management
 *
 * Controls read-only observer mode during takeover operations.
 * When shadow mode is active, channels are deployed but not started,
 * allowing safe observation before progressive cutover.
 */

let shadowMode = false;
const promotedChannels = new Set<string>();

/** Check if shadow mode is globally active */
export function isShadowMode(): boolean {
  return shadowMode;
}

/** Enable or disable shadow mode */
export function setShadowMode(value: boolean): void {
  shadowMode = value;
  if (!value) {
    // When shadow mode is disabled globally, clear promoted set
    promotedChannels.clear();
  }
}

/** Mark a channel as promoted (active) in shadow mode */
export function promoteChannel(channelId: string): void {
  promotedChannels.add(channelId);
}

/** Return a promoted channel to shadow (inactive) state */
export function demoteChannel(channelId: string): void {
  promotedChannels.delete(channelId);
}

/** Check if a specific channel has been promoted */
export function isChannelPromoted(channelId: string): boolean {
  return promotedChannels.has(channelId);
}

/** Promote all channels and disable shadow mode globally */
export function promoteAllChannels(): void {
  shadowMode = false;
  promotedChannels.clear();
}

/** Get the set of currently promoted channel IDs */
export function getPromotedChannels(): Set<string> {
  return new Set(promotedChannels);
}

/**
 * Check if a channel is active (allowed to process messages).
 * A channel is active if:
 * - Shadow mode is disabled globally, OR
 * - The channel has been individually promoted
 */
export function isChannelActive(channelId: string): boolean {
  if (!shadowMode) return true;
  return promotedChannels.has(channelId);
}

/** Reset all shadow mode state (for testing) */
export function resetShadowMode(): void {
  shadowMode = false;
  promotedChannels.clear();
}
