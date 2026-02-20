/**
 * Tests for DelimitedBatchAdaptor
 *
 * Validates all four split modes (Record, Delimiter, Grouping_Column, JavaScript),
 * quote handling, header row inclusion, skip records, and edge cases.
 */

import {
  DelimitedBatchAdaptor,
  DelimitedBatchAdaptorFactory,
  DelimitedSplitType,
} from '../../../../src/datatypes/delimited/DelimitedBatchAdaptor.js';
import type { DelimitedBatchProperties } from '../../../../src/datatypes/delimited/DelimitedBatchAdaptor.js';

/** Helper: drain all messages from an adaptor */
async function drainMessages(adaptor: DelimitedBatchAdaptor): Promise<string[]> {
  const results: string[] = [];
  let msg = await adaptor.getMessage();
  while (msg !== null) {
    results.push(msg);
    msg = await adaptor.getMessage();
  }
  return results;
}

function makeProps(overrides: Partial<DelimitedBatchProperties> = {}): DelimitedBatchProperties {
  return {
    splitType: DelimitedSplitType.Record,
    recordDelimiter: '\\n',
    columnDelimiter: ',',
    ...overrides,
  };
}

// ─── Record Mode ──────────────────────────────────────────

describe('DelimitedBatchAdaptor — Record mode', () => {
  it('splits CSV rows into individual messages', async () => {
    const input = 'Alice,30\nBob,25\nCharlie,35';
    const adaptor = new DelimitedBatchAdaptor(input, makeProps());
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['Alice,30', 'Bob,25', 'Charlie,35']);
    expect(adaptor.isBatchComplete()).toBe(true);
  });

  it('handles tab-delimited records', async () => {
    const input = 'A\t1\nB\t2';
    const adaptor = new DelimitedBatchAdaptor(input, makeProps({ columnDelimiter: '\\t' }));
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A\t1', 'B\t2']);
  });

  it('handles pipe-delimited records with custom record delimiter', async () => {
    const input = 'A|1~B|2~C|3';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ recordDelimiter: '~', columnDelimiter: '|' })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A|1', 'B|2', 'C|3']);
  });

  it('returns empty array for empty input', async () => {
    const adaptor = new DelimitedBatchAdaptor('', makeProps());
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual([]);
    expect(adaptor.isBatchComplete()).toBe(true);
  });

  it('handles single record (no delimiter present)', async () => {
    const adaptor = new DelimitedBatchAdaptor('only,one,row', makeProps());
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['only,one,row']);
  });

  it('ignores trailing delimiter', async () => {
    const input = 'A,1\nB,2\n';
    const adaptor = new DelimitedBatchAdaptor(input, makeProps());
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A,1', 'B,2']);
  });

  it('tracks sequence IDs correctly', async () => {
    const input = 'row1\nrow2\nrow3';
    const adaptor = new DelimitedBatchAdaptor(input, makeProps());

    expect(adaptor.getBatchSequenceId()).toBe(0);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(2);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(3);
  });

  it('prepends column names header when includeColumnNames is true', async () => {
    const input = 'Alice,30\nBob,25';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ includeColumnNames: true, columnNames: 'name,age' })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['name,age\nAlice,30', 'name,age\nBob,25']);
  });

  it('skips header rows when batchSkipRecords is set', async () => {
    const input = 'name,age\nAlice,30\nBob,25';
    const adaptor = new DelimitedBatchAdaptor(input, makeProps({ batchSkipRecords: 1 }));
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['Alice,30', 'Bob,25']);
  });

  it('skips header rows and includes them when both options set', async () => {
    const input = 'name,age\nAlice,30\nBob,25';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ batchSkipRecords: 1, includeColumnNames: true })
    );
    const messages = await drainMessages(adaptor);

    // The skipped first row becomes the header prepended to each message
    expect(messages).toEqual(['name,age\nAlice,30', 'name,age\nBob,25']);
  });
});

// ─── Delimiter Mode ───────────────────────────────────────

describe('DelimitedBatchAdaptor — Delimiter mode', () => {
  it('groups records by message delimiter', async () => {
    const input = 'A,1\nA,2\n---\nB,3\nB,4';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ splitType: DelimitedSplitType.Delimiter, messageDelimiter: '---' })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A,1\nA,2', 'B,3\nB,4']);
  });

  it('includes delimiter in output when messageDelimiterIncluded is true', async () => {
    const input = 'A,1\n---\nB,2';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Delimiter,
        messageDelimiter: '---',
        messageDelimiterIncluded: true,
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A,1\n---', 'B,2']);
  });

  it('handles consecutive delimiters (empty groups)', async () => {
    const input = 'A\n---\n---\nB';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ splitType: DelimitedSplitType.Delimiter, messageDelimiter: '---' })
    );
    const messages = await drainMessages(adaptor);

    // First group is "A", second delimiter produces no group (empty), third group is "B"
    expect(messages).toEqual(['A', 'B']);
  });

  it('flushes remaining records after last delimiter', async () => {
    const input = 'A\n---\nB\nC';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ splitType: DelimitedSplitType.Delimiter, messageDelimiter: '---' })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A', 'B\nC']);
  });

  it('throws when no message delimiter is set', () => {
    expect(
      () =>
        new DelimitedBatchAdaptor(
          'A\nB',
          makeProps({ splitType: DelimitedSplitType.Delimiter })
        )
    ).toThrow('No batch message delimiter was set.');
  });

  it('handles message delimiter that matches a record exactly', async () => {
    // Use a simple string delimiter that matches an entire record
    const input = 'A,1\nB,2\nSEP\nC,3\nD,4';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ splitType: DelimitedSplitType.Delimiter, messageDelimiter: 'SEP' })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A,1\nB,2', 'C,3\nD,4']);
  });

  it('prepends header row in Delimiter mode', async () => {
    const input = 'A,1\n---\nB,2';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Delimiter,
        messageDelimiter: '---',
        includeColumnNames: true,
        columnNames: 'name,val',
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['name,val\nA,1', 'name,val\nB,2']);
  });
});

// ─── Grouping Column Mode ─────────────────────────────────

describe('DelimitedBatchAdaptor — Grouping_Column mode', () => {
  it('groups records by first column value', async () => {
    const input = 'A,1\nA,2\nB,3\nB,4\nC,5';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'column1',
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A,1\nA,2', 'B,3\nB,4', 'C,5']);
  });

  it('groups records by second column', async () => {
    const input = '1,X,a\n2,X,b\n3,Y,c\n4,Y,d';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'column2',
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['1,X,a\n2,X,b', '3,Y,c\n4,Y,d']);
  });

  it('resolves grouping column by user-defined column name', async () => {
    const input = '1,East,a\n2,East,b\n3,West,c';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'region',
        columnNamesList: ['id', 'region', 'code'],
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['1,East,a\n2,East,b', '3,West,c']);
  });

  it('handles quoted values containing column delimiters', async () => {
    const input = '"Smith, John",A\n"Doe, Jane",A\n"Brown, Bob",B';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'column2',
      })
    );
    const messages = await drainMessages(adaptor);

    // Column 2 (0-indexed 1) is A, A, B
    expect(messages).toEqual([
      '"Smith, John",A\n"Doe, Jane",A',
      '"Brown, Bob",B',
    ]);
  });

  it('handles single group (all same column value)', async () => {
    const input = 'A,1\nA,2\nA,3';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'column1',
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A,1\nA,2\nA,3']);
  });

  it('each row becomes its own message when column values alternate', async () => {
    const input = 'A,1\nB,2\nA,3\nB,4';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'column1',
      })
    );
    const messages = await drainMessages(adaptor);

    // Groups by transitions, not by unique values
    expect(messages).toEqual(['A,1', 'B,2', 'A,3', 'B,4']);
  });

  it('throws when no grouping column is set', () => {
    expect(
      () =>
        new DelimitedBatchAdaptor(
          'A\nB',
          makeProps({ splitType: DelimitedSplitType.Grouping_Column })
        )
    ).toThrow('No batch grouping column was set.');
  });

  it('defaults to column 0 when column name is not found', async () => {
    const input = 'A,1\nA,2\nB,3';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'nonexistent',
        columnNamesList: ['id', 'value'],
      })
    );
    const messages = await drainMessages(adaptor);

    // Falls back to column 0 — groups by A, A, B
    expect(messages).toEqual(['A,1\nA,2', 'B,3']);
  });

  it('prepends header row in Grouping_Column mode', async () => {
    const input = 'A,1\nA,2\nB,3';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'column1',
        includeColumnNames: true,
        columnNames: 'letter,number',
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual([
      'letter,number\nA,1\nA,2',
      'letter,number\nB,3',
    ]);
  });

  it('handles pipe-delimited grouping', async () => {
    const input = 'A|1~A|2~B|3';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.Grouping_Column,
        groupingColumn: 'column1',
        recordDelimiter: '~',
        columnDelimiter: '|',
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A|1~A|2', 'B|3']);
  });
});

// ─── JavaScript Mode ──────────────────────────────────────

describe('DelimitedBatchAdaptor — JavaScript mode', () => {
  it('delegates to script batch adaptor', async () => {
    const input = 'line1\nline2\nline3';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.JavaScript,
        batchScript: 'return reader.readLine();',
      })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['line1', 'line2', 'line3']);
  });

  it('throws when no batch script is set', () => {
    expect(
      () =>
        new DelimitedBatchAdaptor(
          'data',
          makeProps({ splitType: DelimitedSplitType.JavaScript })
        )
    ).toThrow('No batch script was set.');
  });

  it('tracks sequence IDs in JavaScript mode', async () => {
    const input = 'A\nB';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({
        splitType: DelimitedSplitType.JavaScript,
        batchScript: 'return reader.readLine();',
      })
    );

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(2);
  });
});

// ─── Factory ──────────────────────────────────────────────

describe('DelimitedBatchAdaptorFactory', () => {
  it('creates adaptor instances with configured properties', async () => {
    const factory = new DelimitedBatchAdaptorFactory(makeProps());
    const adaptor = factory.createBatchAdaptor('row1\nrow2');
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['row1', 'row2']);
  });
});

// ─── Cleanup ──────────────────────────────────────────────

describe('DelimitedBatchAdaptor — cleanup', () => {
  it('resets state on cleanup', async () => {
    const adaptor = new DelimitedBatchAdaptor('A\nB\nC', makeProps());

    await adaptor.getMessage();
    expect(adaptor.getBatchSequenceId()).toBe(1);

    adaptor.cleanup();
    expect(adaptor.getBatchSequenceId()).toBe(0);
    expect(adaptor.isBatchComplete()).toBe(true);

    const msg = await adaptor.getMessage();
    expect(msg).toBeNull();
  });

  it('resets JavaScript mode on cleanup', async () => {
    const adaptor = new DelimitedBatchAdaptor(
      'A\nB',
      makeProps({
        splitType: DelimitedSplitType.JavaScript,
        batchScript: 'return reader.readLine();',
      })
    );

    await adaptor.getMessage();
    adaptor.cleanup();

    expect(adaptor.isBatchComplete()).toBe(true);
    expect(adaptor.getBatchSequenceId()).toBe(0);
  });
});

// ─── Edge Cases ───────────────────────────────────────────

describe('DelimitedBatchAdaptor — edge cases', () => {
  it('handles Windows-style CRLF via escaped record delimiter', async () => {
    const input = 'A,1\r\nB,2\r\nC,3';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ recordDelimiter: '\\r\\n' })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['A,1', 'B,2', 'C,3']);
  });

  it('handles multi-character record delimiter', async () => {
    const input = 'row1||row2||row3';
    const adaptor = new DelimitedBatchAdaptor(
      input,
      makeProps({ recordDelimiter: '||' })
    );
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['row1', 'row2', 'row3']);
  });

  it('handles empty records between delimiters in Record mode', async () => {
    // Empty records between delimiters are skipped (length === 0)
    const input = 'A\n\nB';
    const adaptor = new DelimitedBatchAdaptor(input, makeProps());
    const messages = await drainMessages(adaptor);

    // Empty middle record is included but skipped in Record mode (length check)
    // Actually splitRecords keeps empty strings. Record mode skips empty records.
    expect(messages).toEqual(['A', 'B']);
  });

  it('handles quoted fields with embedded newlines in column parsing', async () => {
    // Note: the record delimiter splits first, so embedded newlines in quotes
    // would need the raw input to NOT contain the record delimiter inside quotes.
    // This test verifies the column parser handles quotes with embedded commas.
    const input = '"a,b",c\n"d,e",f';
    const adaptor = new DelimitedBatchAdaptor(input, makeProps());
    const messages = await drainMessages(adaptor);

    expect(messages).toEqual(['"a,b",c', '"d,e",f']);
  });

  it('handles unknown split type', () => {
    expect(
      () =>
        new DelimitedBatchAdaptor(
          'data',
          makeProps({ splitType: 'Unknown' as DelimitedSplitType })
        )
    ).toThrow('Unknown split type');
  });
});
