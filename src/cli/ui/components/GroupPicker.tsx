/**
 * GroupPicker Component
 *
 * Overlay that lets the user assign selected channel(s) to a group.
 * Pressing 'g' in the list view opens this overlay.
 */

import React, { FC, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ChannelGroup, CHANNEL_GROUP_DEFAULT_NAME } from '../../types/index.js';

export interface GroupPickerProps {
  /** All available groups (including virtual Default Group) */
  groups: ChannelGroup[];
  /** Name of the channel(s) being moved (for display) */
  channelLabel: string;
  /** Called when the user selects a group */
  onSelect: (groupId: string) => void;
  /** Called when the user selects "+ Create new group..." */
  onCreate: (name: string) => void;
  /** Called when the user cancels */
  onCancel: () => void;
}

/**
 * GroupPicker overlay component
 */
export const GroupPicker: FC<GroupPickerProps> = ({
  groups,
  channelLabel,
  onSelect,
  onCreate,
  onCancel,
}) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Build the options list: all groups + "Create new group..."
  const options = [
    ...groups.map((g) => ({ id: g.id, label: g.name })),
    { id: '__create__', label: '+ Create new group...' },
  ];

  useInput((input, key) => {
    if (creatingNew) {
      // In create mode: handle text input
      if (key.escape) {
        setCreatingNew(false);
        setNewGroupName('');
        return;
      }
      if (key.return) {
        const trimmed = newGroupName.trim();
        if (trimmed.length > 0 && trimmed !== CHANNEL_GROUP_DEFAULT_NAME) {
          onCreate(trimmed);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setNewGroupName((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setNewGroupName((prev) => prev + input);
      }
      return;
    }

    // Normal navigation mode
    if (key.escape) {
      onCancel();
    } else if (key.upArrow || input === 'k') {
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIdx((i) => Math.min(options.length - 1, i + 1));
    } else if (key.return) {
      const selected = options[selectedIdx];
      if (!selected) return;
      if (selected.id === '__create__') {
        setCreatingNew(true);
        setNewGroupName('');
      } else {
        onSelect(selected.id);
      }
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
      React.createElement(Text, { bold: true, color: 'cyan' }, 'Move to Group')
    ),
    // Channel label
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { color: 'gray' }, `Channel: ${channelLabel}`)
    ),
    // Options list
    ...options.map((option, index) =>
      React.createElement(
        Box,
        { key: option.id, flexDirection: 'row' },
        React.createElement(
          Text,
          {
            color: index === selectedIdx ? 'cyan' : undefined,
            bold: index === selectedIdx,
          },
          (index === selectedIdx ? '> ' : '  ') + option.label
        )
      )
    ),
    // Create new group input (if active)
    creatingNew &&
      React.createElement(
        Box,
        { marginTop: 1, flexDirection: 'row' },
        React.createElement(Text, { color: 'yellow' }, 'Name: '),
        React.createElement(Text, {}, newGroupName),
        React.createElement(Text, { color: 'gray' }, '_')
      ),
    // Footer
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { color: 'gray', italic: true },
        creatingNew
          ? '[Enter] Create  [Esc] Cancel'
          : '[j/k] Navigate  [Enter] Select  [Esc] Cancel'
      )
    )
  );
};

export default GroupPicker;
