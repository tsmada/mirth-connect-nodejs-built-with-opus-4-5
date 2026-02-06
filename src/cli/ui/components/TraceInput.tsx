/**
 * TraceInput Component
 *
 * Input overlay for entering a message ID to trace.
 * Displays the selected channel name as context and validates
 * that the input is a valid positive integer before submitting.
 */

import React, { FC, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface TraceInputProps {
  /** Channel name shown as context header */
  channelName: string;
  /** Called with the parsed message ID when user submits */
  onSubmit: (messageId: number) => void;
  /** Called when user cancels (Escape) */
  onCancel: () => void;
}

/**
 * Trace message ID input component
 */
export const TraceInput: FC<TraceInputProps> = ({ channelName, onSubmit, onCancel }) => {
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const trimmed = value.trim();
      if (!trimmed) {
        setValidationError('Message ID is required');
        return;
      }
      const parsed = parseInt(trimmed, 10);
      if (isNaN(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
        setValidationError('Must be a positive integer');
        return;
      }
      setValidationError(null);
      onSubmit(parsed);
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setValidationError(null);
      return;
    }

    // Only accept digit characters
    if (input && input.length === 1 && input >= '0' && input <= '9' && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
      setValidationError(null);
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
    // Header
    React.createElement(
      Box,
      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
      React.createElement(Text, { bold: true, color: 'cyan' }, 'Trace Message'),
      React.createElement(Text, { color: 'gray' }, '[Escape] Cancel')
    ),
    // Channel context
    React.createElement(
      Box,
      { flexDirection: 'row', marginBottom: 1 },
      React.createElement(Text, { color: 'gray' }, 'Channel: '),
      React.createElement(Text, { bold: true }, channelName)
    ),
    // Input field
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: 'gray' }, 'Message ID: '),
      React.createElement(Text, null, value || ' '),
      React.createElement(Text, { color: 'cyan' }, '\u2588')
    ),
    // Validation error
    validationError
      ? React.createElement(
          Box,
          { marginTop: 1 },
          React.createElement(Text, { color: 'red' }, validationError)
        )
      : null,
    // Footer
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(Text, { color: 'gray' }, '[Enter] Trace  [Escape] Cancel')
    )
  );
};

export default TraceInput;
