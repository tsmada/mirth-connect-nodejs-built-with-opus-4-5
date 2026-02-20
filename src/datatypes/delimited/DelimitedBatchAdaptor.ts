/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/delimited/DelimitedBatchAdaptor.java
 *
 * Purpose: Splits delimited (CSV, pipe, tab, etc.) batch messages into individual messages
 * using one of four split modes: Record, Delimiter, Grouping_Column, or JavaScript.
 *
 * Key behaviors to replicate:
 * - Record mode: each record (row) is one message
 * - Delimiter mode: records grouped by a message delimiter string
 * - Grouping_Column mode: records grouped by column value transitions
 * - JavaScript mode: delegates to ScriptBatchAdaptor
 * - Quote-aware column parsing (respects quoted values containing delimiters)
 * - Optional header row (columnNames) prepended to each message
 * - Configurable record/column delimiters with escape sequence support
 */

import type { BatchAdaptor, BatchAdaptorFactory } from '../../donkey/message/BatchAdaptor.js';
import { ScriptBatchAdaptor, type ScriptBatchReader } from '../../donkey/message/ScriptBatchAdaptor.js';
import { unescapeDelimiter } from './DelimitedProperties.js';

export enum DelimitedSplitType {
  Record = 'Record',
  Delimiter = 'Delimiter',
  Grouping_Column = 'Grouping_Column',
  JavaScript = 'JavaScript',
}

export interface DelimitedBatchProperties {
  splitType: DelimitedSplitType;
  /** Record delimiter (default: "\\n") */
  recordDelimiter: string;
  /** Column delimiter (default: ",") */
  columnDelimiter: string;
  /** Message delimiter string (for Delimiter mode) */
  messageDelimiter?: string;
  /** Whether to include the message delimiter in the output (for Delimiter mode) */
  messageDelimiterIncluded?: boolean;
  /** Column name or index for grouping (for Grouping_Column mode) */
  groupingColumn?: string;
  /** Whether to include column names row in each batch message */
  includeColumnNames?: boolean;
  /** Column names row (first row of the input, or user-configured) */
  columnNames?: string;
  /** User-defined column name list (from serialization properties) */
  columnNamesList?: string[];
  /** Quote token for CSV parsing (default: '"') */
  quoteToken?: string;
  /** Number of header rows to skip at the top of the input */
  batchSkipRecords?: number;
  /** Batch script for JavaScript mode */
  batchScript?: string;
}

/**
 * Parse a single record (row) into column values, respecting quoted fields.
 *
 * The state machine tracks whether we're inside a quoted value to avoid
 * splitting on column delimiters that appear within quotes.
 */
function parseRecordColumns(
  record: string,
  columnDelimiter: string,
  quoteToken: string
): string[] {
  const columns: string[] = [];
  let current = '';
  let inQuote = false;
  let i = 0;

  while (i < record.length) {
    // Check for quote token
    if (!inQuote && record.startsWith(quoteToken, i)) {
      inQuote = true;
      i += quoteToken.length;
      continue;
    }

    if (inQuote) {
      // Check for escaped quote (double-quote inside quoted field)
      if (record.startsWith(quoteToken + quoteToken, i)) {
        current += quoteToken;
        i += quoteToken.length * 2;
        continue;
      }
      // Check for closing quote
      if (record.startsWith(quoteToken, i)) {
        inQuote = false;
        i += quoteToken.length;
        continue;
      }
      current += record[i]!;
      i++;
      continue;
    }

    // Check for column delimiter (outside quotes)
    if (record.startsWith(columnDelimiter, i)) {
      columns.push(current);
      current = '';
      i += columnDelimiter.length;
      continue;
    }

    current += record[i]!;
    i++;
  }

  columns.push(current);
  return columns;
}

/**
 * Resolve a grouping column reference to a 0-based column index.
 *
 * Java's updateGroupingColumnIndex() logic:
 * 1. If user-defined columnNames exist, find the column by name match
 * 2. Otherwise, try to parse the trailing digits from a default "columnN" name (1-based)
 * 3. If neither resolves, default to column 0
 */
function resolveGroupingColumnIndex(
  groupingColumn: string,
  columnNamesList?: string[]
): number {
  if (!groupingColumn) return 0;

  // If user-defined column names are provided, look up by name
  if (columnNamesList && columnNamesList.length > 0) {
    const idx = columnNamesList.indexOf(groupingColumn);
    return idx >= 0 ? idx : 0;
  }

  // Try to parse trailing digits from default "columnN" naming convention (1-based)
  const match = groupingColumn.match(/(\d+)$/);
  if (match) {
    const num = parseInt(match[1]!, 10);
    return num > 0 ? num - 1 : 0;
  }

  // If it's a raw number, treat as 0-based index
  const parsed = parseInt(groupingColumn, 10);
  if (!isNaN(parsed)) {
    return parsed;
  }

  return 0;
}

/**
 * Split input into records using the record delimiter.
 * Returns non-empty record strings.
 */
function splitRecords(input: string, recordDelimiter: string): string[] {
  if (!input || input.length === 0) return [];

  const parts = input.split(recordDelimiter);
  // Keep all records including empties between delimiters, but filter truly empty results
  // at the end caused by trailing delimiters
  const records: string[] = [];
  for (const part of parts) {
    records.push(part);
  }

  // Trim trailing empty record caused by trailing delimiter
  while (records.length > 0 && records[records.length - 1] === '') {
    records.pop();
  }

  return records;
}

export class DelimitedBatchAdaptor implements BatchAdaptor {
  private messages: string[] = [];
  private index: number = 0;
  private sequenceId: number = 0;
  private scriptAdaptor: ScriptBatchAdaptor | null = null;

  constructor(rawMessage: string, props: DelimitedBatchProperties) {
    const recordDelimiter = unescapeDelimiter(props.recordDelimiter || '\\n');
    const columnDelimiter = unescapeDelimiter(props.columnDelimiter || ',');
    const quoteToken = props.quoteToken ?? '"';
    const skipRecords = props.batchSkipRecords ?? 0;

    if (props.splitType === DelimitedSplitType.JavaScript) {
      this.initJavaScript(rawMessage, props);
      return;
    }

    let records = splitRecords(rawMessage, recordDelimiter);
    if (records.length === 0) return;

    // Skip header rows if configured
    let headerRow: string | undefined;
    if (skipRecords > 0) {
      // Save first row as potential column names header before skipping
      if (props.includeColumnNames && records.length > 0) {
        headerRow = records[0];
      }
      records = records.slice(skipRecords);
    } else if (props.includeColumnNames && props.columnNames) {
      headerRow = props.columnNames;
    }

    switch (props.splitType) {
      case DelimitedSplitType.Record:
        this.splitByRecord(records, headerRow, recordDelimiter);
        break;
      case DelimitedSplitType.Delimiter:
        this.splitByDelimiter(records, props, headerRow, recordDelimiter);
        break;
      case DelimitedSplitType.Grouping_Column:
        this.splitByGroupingColumn(
          records,
          props,
          columnDelimiter,
          quoteToken,
          headerRow,
          recordDelimiter
        );
        break;
      default:
        throw new Error(`Unknown split type: ${props.splitType}`);
    }
  }

  private splitByRecord(
    records: string[],
    headerRow: string | undefined,
    recordDelimiter: string
  ): void {
    for (const record of records) {
      if (record.length === 0) continue;
      if (headerRow !== undefined) {
        this.messages.push(headerRow + recordDelimiter + record);
      } else {
        this.messages.push(record);
      }
    }
  }

  private splitByDelimiter(
    records: string[],
    props: DelimitedBatchProperties,
    headerRow: string | undefined,
    recordDelimiter: string
  ): void {
    if (!props.messageDelimiter) {
      throw new Error('No batch message delimiter was set.');
    }

    const msgDelimiter = unescapeDelimiter(props.messageDelimiter);
    const includeDelimiter = props.messageDelimiterIncluded ?? false;
    let accumulated: string[] = [];

    for (const record of records) {
      // Check if this record IS the message delimiter
      if (record === msgDelimiter) {
        if (accumulated.length > 0) {
          let msg = accumulated.join(recordDelimiter);
          if (includeDelimiter) {
            msg += recordDelimiter + msgDelimiter;
          }
          if (headerRow !== undefined) {
            msg = headerRow + recordDelimiter + msg;
          }
          this.messages.push(msg);
          accumulated = [];
        }
        continue;
      }

      accumulated.push(record);
    }

    // Flush remaining records
    if (accumulated.length > 0) {
      let msg = accumulated.join(recordDelimiter);
      if (headerRow !== undefined) {
        msg = headerRow + recordDelimiter + msg;
      }
      this.messages.push(msg);
    }
  }

  private splitByGroupingColumn(
    records: string[],
    props: DelimitedBatchProperties,
    columnDelimiter: string,
    quoteToken: string,
    headerRow: string | undefined,
    recordDelimiter: string
  ): void {
    if (!props.groupingColumn) {
      throw new Error('No batch grouping column was set.');
    }

    const colIndex = resolveGroupingColumnIndex(
      props.groupingColumn,
      props.columnNamesList
    );

    let currentGroup: string[] = [];
    let lastValue: string | undefined;

    for (const record of records) {
      if (record.length === 0) continue;

      const columns = parseRecordColumns(record, columnDelimiter, quoteToken);
      const colValue = colIndex < columns.length ? columns[colIndex]! : '';

      if (lastValue !== undefined && colValue !== lastValue) {
        // Value changed — flush current group
        let msg = currentGroup.join(recordDelimiter);
        if (headerRow !== undefined) {
          msg = headerRow + recordDelimiter + msg;
        }
        this.messages.push(msg);
        currentGroup = [];
      }

      currentGroup.push(record);
      lastValue = colValue;
    }

    // Flush remaining group
    if (currentGroup.length > 0) {
      let msg = currentGroup.join(recordDelimiter);
      if (headerRow !== undefined) {
        msg = headerRow + recordDelimiter + msg;
      }
      this.messages.push(msg);
    }
  }

  private initJavaScript(rawMessage: string, props: DelimitedBatchProperties): void {
    if (!props.batchScript) {
      throw new Error('No batch script was set.');
    }

    // Build the batch script function from the user's script string
    // The script receives { reader, sourceMap } and should return the next message or null
    // eslint-disable-next-line no-new-func
    const scriptFn = new Function(
      'context',
      `const { reader, sourceMap } = context; ${props.batchScript}`
    ) as (context: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => string | null;

    this.scriptAdaptor = new ScriptBatchAdaptor(rawMessage, scriptFn);
  }

  async getMessage(): Promise<string | null> {
    // JavaScript mode delegates entirely to ScriptBatchAdaptor
    if (this.scriptAdaptor) {
      const msg = await this.scriptAdaptor.getMessage();
      this.sequenceId = this.scriptAdaptor.getBatchSequenceId();
      return msg;
    }

    if (this.index >= this.messages.length) {
      return null;
    }
    this.sequenceId = this.index + 1;
    return this.messages[this.index++]!;
  }

  getBatchSequenceId(): number {
    return this.sequenceId;
  }

  isBatchComplete(): boolean {
    if (this.scriptAdaptor) {
      return this.scriptAdaptor.isBatchComplete();
    }
    return this.index >= this.messages.length;
  }

  cleanup(): void {
    if (this.scriptAdaptor) {
      this.scriptAdaptor.cleanup();
      this.scriptAdaptor = null;
    }
    this.messages = [];
    this.index = 0;
    this.sequenceId = 0;
  }
}

export class DelimitedBatchAdaptorFactory implements BatchAdaptorFactory {
  private props: DelimitedBatchProperties;

  constructor(props: DelimitedBatchProperties) {
    this.props = props;
  }

  createBatchAdaptor(rawMessage: string): DelimitedBatchAdaptor {
    return new DelimitedBatchAdaptor(rawMessage, this.props);
  }
}
