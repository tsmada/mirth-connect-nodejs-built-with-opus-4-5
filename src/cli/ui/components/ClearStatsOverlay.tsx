/**
 * ClearStatsOverlay Component
 *
 * Checkbox overlay for selecting which statistic types to clear.
 * Mirrors Java Mirth's DeleteStatisticsDialog with 4 checkboxes
 * (Received, Filtered, Sent, Error) and an Invert Selection action.
 */

import React, { FC, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ClearStatsOptions {
  received: boolean;
  filtered: boolean;
  sent: boolean;
  error: boolean;
}

export interface ClearStatsOverlayProps {
  /** Number of channels to clear */
  channelCount: number;
  /** Display label: channel name or "N channel(s)" */
  channelLabel: string;
  /** Called when the user confirms the selection */
  onConfirm: (options: ClearStatsOptions) => void;
  /** Called when the user cancels */
  onCancel: () => void;
}

interface CheckboxItem {
  key: keyof ClearStatsOptions;
  label: string;
}

const ITEMS: CheckboxItem[] = [
  { key: 'received', label: 'Received' },
  { key: 'filtered', label: 'Filtered' },
  { key: 'sent', label: 'Sent' },
  { key: 'error', label: 'Error' },
];

/**
 * ClearStatsOverlay component
 */
export const ClearStatsOverlay: FC<ClearStatsOverlayProps> = ({
  channelLabel,
  onConfirm,
  onCancel,
}) => {
  const [focusIndex, setFocusIndex] = useState(0);
  const [checked, setChecked] = useState<ClearStatsOptions>({
    received: true,
    filtered: true,
    sent: true,
    error: true,
  });

  const noneSelected = !checked.received && !checked.filtered && !checked.sent && !checked.error;

  useInput((input, key) => {
    // Navigation
    if (key.upArrow || input === 'k') {
      setFocusIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === 'j') {
      setFocusIndex((i) => Math.min(ITEMS.length - 1, i + 1));
    }
    // Toggle checkbox
    else if (input === ' ') {
      const item = ITEMS[focusIndex];
      if (item) {
        setChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
      }
    }
    // Invert all
    else if (input === 'i' || input === 'I') {
      setChecked((prev) => ({
        received: !prev.received,
        filtered: !prev.filtered,
        sent: !prev.sent,
        error: !prev.error,
      }));
    }
    // Confirm
    else if (key.return) {
      if (!noneSelected) {
        onConfirm(checked);
      }
    }
    // Cancel
    else if (key.escape) {
      onCancel();
    }
  });

  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(50, termWidth - 4);

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
      React.createElement(Text, { bold: true, color: 'cyan' }, 'Clear Statistics')
    ),
    // Scope label
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { color: 'gray' }, `Scope: ${channelLabel}`)
    ),
    // Checkbox items
    ...ITEMS.map((item, index) => {
      const isFocused = index === focusIndex;
      const isChecked = checked[item.key];
      const cursor = isFocused ? '\u25B6 ' : '  ';
      const box = isChecked ? '[x]' : '[ ]';

      return React.createElement(
        Box,
        { key: item.key, flexDirection: 'row' },
        React.createElement(
          Text,
          {
            color: isFocused ? 'cyan' : isChecked ? 'cyan' : 'gray',
            bold: isFocused,
          },
          `${cursor}${box} ${item.label}`
        )
      );
    }),
    // Warning if none selected
    noneSelected &&
      React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: 'yellow' }, 'Select at least one statistic type')
      ),
    // Footer
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { color: 'gray', italic: true },
        '[Enter] Clear  [I] Invert  [Space] Toggle  [Esc] Cancel'
      )
    )
  );
};

export default ClearStatsOverlay;
