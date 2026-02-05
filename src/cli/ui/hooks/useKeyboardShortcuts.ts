/**
 * useKeyboardShortcuts Hook
 *
 * Centralized keyboard shortcut handling for the dashboard.
 */

import { useCallback } from 'react';
import { useInput, Key } from 'ink';
import { ViewMode } from '../context/DashboardContext.js';

export interface KeyboardAction {
  key: string;
  description: string;
  handler: () => void | Promise<void>;
  context?: ViewMode | ViewMode[];
  modifiers?: {
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
  };
}

export interface UseKeyboardShortcutsOptions {
  /** Current view mode */
  viewMode: ViewMode;
  /** Whether input is focused (e.g., in search mode) */
  inputFocused?: boolean;
  /** List of keyboard actions to register */
  actions: KeyboardAction[];
  /** Callback when unhandled input is received */
  onUnhandledInput?: (input: string, key: Key) => void;
}

/**
 * Check if a key matches an action
 */
function keyMatches(input: string, key: Key, action: KeyboardAction): boolean {
  // Handle special keys
  if (action.key === 'up' && key.upArrow) return true;
  if (action.key === 'down' && key.downArrow) return true;
  if (action.key === 'left' && key.leftArrow) return true;
  if (action.key === 'right' && key.rightArrow) return true;
  if (action.key === 'enter' && key.return) return true;
  if (action.key === 'escape' && key.escape) return true;
  if (action.key === 'tab' && key.tab) return true;
  if (action.key === 'backspace' && key.backspace) return true;
  if (action.key === 'delete' && key.delete) return true;
  if (action.key === 'space' && input === ' ') return true;
  if (action.key === 'pageup' && key.pageUp) return true;
  if (action.key === 'pagedown' && key.pageDown) return true;

  // Handle character keys (case-insensitive by default)
  if (action.key.length === 1) {
    return input.toLowerCase() === action.key.toLowerCase();
  }

  return false;
}

/**
 * Check if action context matches current view mode
 */
function contextMatches(viewMode: ViewMode, action: KeyboardAction): boolean {
  if (!action.context) return true;

  if (Array.isArray(action.context)) {
    return action.context.includes(viewMode);
  }

  return action.context === viewMode;
}

/**
 * Hook for managing keyboard shortcuts
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { viewMode, inputFocused = false, actions, onUnhandledInput } = options;

  const handleInput = useCallback(
    (input: string, key: Key) => {
      // Skip handling if input is focused (e.g., search box)
      if (inputFocused) {
        onUnhandledInput?.(input, key);
        return;
      }

      // Find matching action
      for (const action of actions) {
        if (keyMatches(input, key, action) && contextMatches(viewMode, action)) {
          action.handler();
          return;
        }
      }

      // No match, call unhandled handler
      onUnhandledInput?.(input, key);
    },
    [viewMode, inputFocused, actions, onUnhandledInput]
  );

  useInput(handleInput);
}

/**
 * Standard dashboard shortcuts (for reference/help display)
 */
export const STANDARD_SHORTCUTS = {
  navigation: [
    { key: '↑/k', description: 'Move up' },
    { key: '↓/j', description: 'Move down' },
    { key: 'Enter', description: 'Expand/Details' },
    { key: 'Space', description: 'Toggle selection' },
  ],
  channelActions: [
    { key: 's', description: 'Start channel' },
    { key: 't', description: 'Stop channel' },
    { key: 'p', description: 'Pause/Resume' },
    { key: 'd', description: 'Deploy' },
    { key: 'u', description: 'Undeploy' },
  ],
  viewActions: [
    { key: 'm', description: 'Messages view' },
    { key: '/', description: 'Search' },
    { key: '?', description: 'Help' },
    { key: 'r', description: 'Refresh' },
    { key: 'q', description: 'Quit' },
  ],
  selection: [
    { key: 'a', description: 'Select all' },
    { key: 'c', description: 'Clear selection' },
  ],
  groupActions: [
    { key: 'e', description: 'Expand all groups' },
    { key: 'w', description: 'Collapse all groups' },
  ],
};

/**
 * Format shortcuts for help display
 */
export function formatShortcutsForHelp(): string[][] {
  const sections: string[][] = [];

  sections.push(['Navigation', ...STANDARD_SHORTCUTS.navigation.map((s) => `${s.key}: ${s.description}`)]);
  sections.push(['Channel Actions', ...STANDARD_SHORTCUTS.channelActions.map((s) => `${s.key}: ${s.description}`)]);
  sections.push(['View Actions', ...STANDARD_SHORTCUTS.viewActions.map((s) => `${s.key}: ${s.description}`)]);
  sections.push(['Selection', ...STANDARD_SHORTCUTS.selection.map((s) => `${s.key}: ${s.description}`)]);
  sections.push(['Groups', ...STANDARD_SHORTCUTS.groupActions.map((s) => `${s.key}: ${s.description}`)]);

  return sections;
}

export default useKeyboardShortcuts;
