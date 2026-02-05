/**
 * HelpOverlay Component
 *
 * Full-screen help overlay with all keyboard shortcuts.
 */

import React, { FC } from 'react';
import { Box, Text, useInput } from 'ink';

export interface HelpOverlayProps {
  onClose: () => void;
}

interface ShortcutCategory {
  title: string;
  shortcuts: { key: string; description: string }[];
}

const HELP_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { key: '↑ / k', description: 'Move up' },
      { key: '↓ / j', description: 'Move down' },
      { key: 'Enter', description: 'Expand group / Show details' },
      { key: 'Tab', description: 'Switch tabs (in details view)' },
      { key: 'Escape', description: 'Close overlay / Cancel' },
    ],
  },
  {
    title: 'Channel Actions',
    shortcuts: [
      { key: 's', description: 'Start channel' },
      { key: 't', description: 'Stop channel' },
      { key: 'p', description: 'Pause / Resume channel' },
      { key: 'd', description: 'Deploy channel' },
      { key: 'u', description: 'Undeploy channel' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { key: 'Space', description: 'Toggle selection' },
      { key: 'a', description: 'Select all channels' },
      { key: 'c', description: 'Clear selection' },
    ],
  },
  {
    title: 'Views',
    shortcuts: [
      { key: 'm', description: 'Messages view' },
      { key: '/', description: 'Search / Filter' },
      { key: '?', description: 'Show this help' },
    ],
  },
  {
    title: 'Groups',
    shortcuts: [
      { key: 'e', description: 'Expand all groups' },
      { key: 'w', description: 'Collapse all groups' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { key: 'r', description: 'Refresh data' },
      { key: 'q / Q', description: 'Quit dashboard' },
    ],
  },
];

/**
 * Help overlay component
 */
export const HelpOverlay: FC<HelpOverlayProps> = ({ onClose }) => {
  // Close on any key press
  useInput(() => {
    onClose();
  });

  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(60, termWidth - 4);

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'cyan',
      paddingX: 2,
      paddingY: 1,
      width: boxWidth,
    },
    // Title
    React.createElement(
      Box,
      { justifyContent: 'center', marginBottom: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, 'Keyboard Shortcuts')
    ),
    // Categories
    ...HELP_CATEGORIES.map((category) =>
      React.createElement(
        Box,
        { key: category.title, flexDirection: 'column', marginBottom: 1 },
        React.createElement(Text, { bold: true, underline: true }, category.title),
        ...category.shortcuts.map((shortcut) =>
          React.createElement(
            Box,
            { key: shortcut.key, flexDirection: 'row' },
            React.createElement(
              Text,
              { color: 'yellow' },
              shortcut.key.padEnd(12)
            ),
            React.createElement(Text, { color: 'gray' }, shortcut.description)
          )
        )
      )
    ),
    // Footer
    React.createElement(
      Box,
      { marginTop: 1, justifyContent: 'center' },
      React.createElement(Text, { color: 'gray', italic: true }, 'Press any key to close')
    )
  );
};

export default HelpOverlay;
