/**
 * HelpBar Component
 *
 * Contextual keyboard shortcut hints at bottom of dashboard.
 */

import React, { FC } from 'react';
import { Box, Text } from 'ink';
import { ViewMode } from '../context/DashboardContext.js';

export interface HelpBarProps {
  viewMode: ViewMode;
  hasSelection?: boolean;
}

interface ShortcutHint {
  key: string;
  label: string;
}

const LIST_SHORTCUTS: ShortcutHint[] = [
  { key: '↑↓', label: 'Navigate' },
  { key: 'S', label: 'Start' },
  { key: 'T', label: 'Stop' },
  { key: 'P', label: 'Pause' },
  { key: 'D', label: 'Deploy' },
  { key: 'U', label: 'Undeploy' },
  { key: 'R', label: 'Refresh' },
  { key: '/', label: 'Search' },
  { key: '?', label: 'Help' },
  { key: 'X', label: 'Trace' },
  { key: 'Q', label: 'Quit' },
];

const LIST_WITH_SELECTION_SHORTCUTS: ShortcutHint[] = [
  { key: '↑↓', label: 'Navigate' },
  { key: 'Space', label: 'Select' },
  { key: 'S', label: 'Start' },
  { key: 'T', label: 'Stop' },
  { key: 'A', label: 'Select All' },
  { key: 'C', label: 'Clear' },
  { key: 'Q', label: 'Quit' },
];

const SEARCH_SHORTCUTS: ShortcutHint[] = [
  { key: 'Type', label: 'Filter' },
  { key: 'Enter', label: 'Select' },
  { key: 'Esc', label: 'Cancel' },
];

const DETAILS_SHORTCUTS: ShortcutHint[] = [
  { key: 'S', label: 'Start' },
  { key: 'T', label: 'Stop' },
  { key: 'M', label: 'Messages' },
  { key: 'X', label: 'Trace' },
  { key: 'Esc', label: 'Close' },
];

const HELP_SHORTCUTS: ShortcutHint[] = [{ key: 'Any', label: 'Close' }];

const MESSAGES_SHORTCUTS: ShortcutHint[] = [
  { key: '↑↓', label: 'Navigate' },
  { key: 'Enter', label: 'View' },
  { key: 'X', label: 'Trace' },
  { key: 'F', label: 'Filter' },
  { key: 'N·B', label: 'Page' },
  { key: 'R', label: 'Refresh' },
  { key: 'Esc', label: 'Back' },
];

const MESSAGE_DETAIL_SHORTCUTS: ShortcutHint[] = [
  { key: 'Tab', label: 'Switch Tab' },
  { key: '↑↓', label: 'Navigate' },
  { key: 'X', label: 'Trace' },
  { key: 'Esc', label: 'Back' },
];

const TRACE_INPUT_SHORTCUTS: ShortcutHint[] = [
  { key: 'Enter', label: 'Trace' },
  { key: 'Esc', label: 'Cancel' },
];

const TRACE_SHORTCUTS: ShortcutHint[] = [
  { key: '↑↓', label: 'Scroll' },
  { key: 'V', label: 'Verbose' },
  { key: 'Esc', label: 'Back' },
];

function getShortcuts(viewMode: ViewMode, hasSelection: boolean): ShortcutHint[] {
  switch (viewMode) {
    case 'search':
      return SEARCH_SHORTCUTS;
    case 'details':
      return DETAILS_SHORTCUTS;
    case 'help':
      return HELP_SHORTCUTS;
    case 'messages':
      return MESSAGES_SHORTCUTS;
    case 'messageDetail':
      return MESSAGE_DETAIL_SHORTCUTS;
    case 'traceInput':
      return TRACE_INPUT_SHORTCUTS;
    case 'trace':
      return TRACE_SHORTCUTS;
    case 'list':
    default:
      return hasSelection ? LIST_WITH_SELECTION_SHORTCUTS : LIST_SHORTCUTS;
  }
}

/**
 * Help bar component
 */
export const HelpBar: FC<HelpBarProps> = ({ viewMode, hasSelection = false }) => {
  const shortcuts = getShortcuts(viewMode, hasSelection);

  const shortcutText = shortcuts.map((s) => `[${s.key}] ${s.label}`).join('  ');

  return React.createElement(
    Box,
    { marginTop: 1, flexDirection: 'row' },
    React.createElement(Text, { color: 'gray' }, shortcutText)
  );
};

export default HelpBar;
