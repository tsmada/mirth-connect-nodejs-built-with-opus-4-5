/**
 * CLI Dashboard Hooks
 */

export { useWebSocket } from './useWebSocket.js';
export type { UseWebSocketOptions, UseWebSocketResult, WebSocketStatus } from './useWebSocket.js';

export { useChannels } from './useChannels.js';
export type { UseChannelsOptions, UseChannelsResult } from './useChannels.js';

export { useChannelGroups } from './useChannelGroups.js';
export type {
  UseChannelGroupsOptions,
  UseChannelGroupsResult,
  GroupedChannel,
} from './useChannelGroups.js';

export {
  useKeyboardShortcuts,
  STANDARD_SHORTCUTS,
  formatShortcutsForHelp,
} from './useKeyboardShortcuts.js';
export type { KeyboardAction, UseKeyboardShortcutsOptions } from './useKeyboardShortcuts.js';
