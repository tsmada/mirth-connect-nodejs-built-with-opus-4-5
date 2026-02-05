/**
 * SearchInput Component
 *
 * Search/filter input box.
 */

import React, { FC, useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder?: string;
}

/**
 * Search input component
 */
export const SearchInput: FC<SearchInputProps> = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder = 'Type to search...',
}) => {
  const [cursorVisible, setCursorVisible] = useState(true);

  // Blink cursor
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Handle input
  useInput((input, key) => {
    if (key.return) {
      onSubmit();
    } else if (key.escape) {
      onCancel();
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      // Only accept printable characters
      if (input.length === 1 && input.charCodeAt(0) >= 32) {
        onChange(value + input);
      }
    }
  });

  const cursor = cursorVisible ? '█' : ' ';
  const displayValue = value || placeholder;
  const isPlaceholder = !value;

  return React.createElement(
    Box,
    { flexDirection: 'row' },
    React.createElement(Text, { color: 'cyan' }, '/'),
    React.createElement(
      Text,
      { color: isPlaceholder ? 'gray' : 'white' },
      displayValue
    ),
    !isPlaceholder && React.createElement(Text, { color: 'cyan' }, cursor)
  );
};

export default SearchInput;
