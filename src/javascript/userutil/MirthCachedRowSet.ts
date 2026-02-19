/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/MirthCachedRowSet.java
 *
 * Purpose: A disconnected, in-memory result set that uses column labels (aliases) for lookups.
 *
 * Key behaviors to replicate:
 * - Store query results in memory (no active connection needed)
 * - Use column label for lookups, not just column name (important for SELECT aliases)
 * - Provide typed getters: getString, getInt, getBoolean, getDate, etc.
 * - Support iteration: next(), getRow(), etc.
 * - Implement metadata access: getMetaData(), findColumn()
 *
 * Design note: Unlike Java's CachedRowSet which extends RowSet/ResultSet,
 * this is a simpler TypeScript implementation focused on the methods actually
 * used by Mirth Connect scripts.
 */

/**
 * Represents column metadata for the result set.
 */
export interface ColumnMetaData {
  /** Column index (1-based) */
  columnIndex: number;
  /** The actual column name from the database */
  columnName: string;
  /** The column label (alias) - this is what we use for lookups */
  columnLabel: string;
  /** SQL type name */
  columnTypeName: string;
}

/**
 * Metadata for a cached row set.
 */
export interface RowSetMetaData {
  /** Number of columns */
  getColumnCount(): number;
  /** Get column name (1-based index) */
  getColumnName(column: number): string;
  /** Get column label/alias (1-based index) - this is what we use for lookups */
  getColumnLabel(column: number): string;
  /** Get column type name (1-based index) */
  getColumnTypeName(column: number): string;
}

/**
 * An implementation of CachedRowSet that retrieves values based on the column label value.
 * CachedRowSetImpl uses the column name which ignores alias for drivers that correctly follow
 * the JDBC 4.0 recommendations. Using the column label ensures that aliases will work.
 *
 * This class stores query results in memory, allowing disconnected access to result data
 * after the database connection has been closed.
 */
export class MirthCachedRowSet {
  private rows: Record<string, unknown>[] = [];
  private columns: ColumnMetaData[] = [];
  private currentRowIndex = -1; // Before first row
  private lastWasNull = false;

  constructor() {
    // Initialize empty
  }

  /**
   * Populates this cached row set from query result rows and column metadata.
   *
   * @param rows - Array of row objects from query result
   * @param columns - Array of column metadata (from mysql2 fields or similar)
   */
  populate(
    rows: Record<string, unknown>[],
    columns: Array<{ name: string; table?: string; type?: string | number }>
  ): void {
    this.rows = rows;
    this.columns = columns.map((col, index) => ({
      columnIndex: index + 1,
      columnName: col.name,
      columnLabel: col.name, // mysql2 uses name for both
      columnTypeName: String(col.type || 'VARCHAR'),
    }));
    this.currentRowIndex = -1; // Reset to before first row
  }

  /**
   * Gets the number of rows in this cached row set.
   */
  size(): number {
    return this.rows.length;
  }

  /**
   * Returns true if there are no rows.
   */
  isEmpty(): boolean {
    return this.rows.length === 0;
  }

  // =====================================================
  // Cursor Movement Methods
  // =====================================================

  /**
   * Moves the cursor to the next row.
   * @returns true if the new current row is valid; false if there are no more rows
   */
  next(): boolean {
    if (this.currentRowIndex < this.rows.length - 1) {
      this.currentRowIndex++;
      return true;
    }
    return false;
  }

  /**
   * Moves the cursor to the previous row.
   * @returns true if the new current row is valid; false if cursor is before first row
   */
  previous(): boolean {
    if (this.currentRowIndex > 0) {
      this.currentRowIndex--;
      return true;
    }
    if (this.currentRowIndex === 0) {
      this.currentRowIndex = -1;
    }
    return false;
  }

  /**
   * Moves the cursor to the first row.
   * @returns true if the cursor is on a valid row; false if no rows
   */
  first(): boolean {
    if (this.rows.length > 0) {
      this.currentRowIndex = 0;
      return true;
    }
    return false;
  }

  /**
   * Moves the cursor to the last row.
   * @returns true if the cursor is on a valid row; false if no rows
   */
  last(): boolean {
    if (this.rows.length > 0) {
      this.currentRowIndex = this.rows.length - 1;
      return true;
    }
    return false;
  }

  /**
   * Moves the cursor to the given row number.
   * Row numbers are 1-based.
   * @param row - The row number to move to (1-based)
   * @returns true if the cursor is on a valid row; false otherwise
   */
  absolute(row: number): boolean {
    if (row === 0) {
      this.currentRowIndex = -1;
      return false;
    }

    if (row > 0) {
      // Positive: absolute row number (1-based)
      if (row <= this.rows.length) {
        this.currentRowIndex = row - 1;
        return true;
      }
      this.currentRowIndex = this.rows.length; // After last
      return false;
    } else {
      // Negative: relative from end
      const targetIndex = this.rows.length + row;
      if (targetIndex >= 0) {
        this.currentRowIndex = targetIndex;
        return true;
      }
      this.currentRowIndex = -1; // Before first
      return false;
    }
  }

  /**
   * Moves the cursor a relative number of rows.
   * @param rows - Number of rows to move (positive = forward, negative = backward)
   * @returns true if the cursor is on a valid row; false otherwise
   */
  relative(rows: number): boolean {
    const targetIndex = this.currentRowIndex + rows;
    if (targetIndex >= 0 && targetIndex < this.rows.length) {
      this.currentRowIndex = targetIndex;
      return true;
    }
    if (targetIndex < 0) {
      this.currentRowIndex = -1;
    } else {
      this.currentRowIndex = this.rows.length;
    }
    return false;
  }

  /**
   * Moves the cursor to before the first row.
   */
  beforeFirst(): void {
    this.currentRowIndex = -1;
  }

  /**
   * Moves the cursor to after the last row.
   */
  afterLast(): void {
    this.currentRowIndex = this.rows.length;
  }

  /**
   * Returns true if the cursor is before the first row.
   */
  isBeforeFirst(): boolean {
    return this.rows.length > 0 && this.currentRowIndex === -1;
  }

  /**
   * Returns true if the cursor is after the last row.
   */
  isAfterLast(): boolean {
    return this.rows.length > 0 && this.currentRowIndex >= this.rows.length;
  }

  /**
   * Returns true if the cursor is on the first row.
   */
  isFirst(): boolean {
    return this.rows.length > 0 && this.currentRowIndex === 0;
  }

  /**
   * Returns true if the cursor is on the last row.
   */
  isLast(): boolean {
    return this.rows.length > 0 && this.currentRowIndex === this.rows.length - 1;
  }

  /**
   * Returns the current row number (1-based).
   * Returns 0 if the cursor is before the first row or after the last row.
   */
  getRow(): number {
    if (this.currentRowIndex >= 0 && this.currentRowIndex < this.rows.length) {
      return this.currentRowIndex + 1;
    }
    return 0;
  }

  // =====================================================
  // Column Index Resolution
  // =====================================================

  /**
   * Finds the column index for a column name/label (case-insensitive).
   * @param columnLabel - The column name or label to find
   * @returns The column index (1-based)
   * @throws Error if the column is not found
   */
  findColumn(columnLabel: string): number {
    const lowerLabel = columnLabel.toLowerCase();

    for (const col of this.columns) {
      if (
        col.columnLabel.toLowerCase() === lowerLabel ||
        col.columnName.toLowerCase() === lowerLabel
      ) {
        return col.columnIndex;
      }
    }

    throw new Error(`Invalid column name: ${columnLabel}`);
  }

  /**
   * Gets the column index, either from a number (passed through) or string (looked up).
   */
  private getColumnIndex(columnIndexOrLabel: number | string): number {
    if (typeof columnIndexOrLabel === 'string') {
      return this.findColumn(columnIndexOrLabel);
    }
    return columnIndexOrLabel;
  }

  /**
   * Gets the current row's value for a column.
   */
  private getValue(columnIndexOrLabel: number | string): unknown {
    if (this.currentRowIndex < 0 || this.currentRowIndex >= this.rows.length) {
      throw new Error('Invalid cursor position');
    }

    const columnIndex = this.getColumnIndex(columnIndexOrLabel);
    const column = this.columns.find((c) => c.columnIndex === columnIndex);

    if (!column) {
      throw new Error(`Invalid column index: ${columnIndex}`);
    }

    const row = this.rows[this.currentRowIndex];
    const value = row![column.columnLabel] ?? row![column.columnName];

    this.lastWasNull = value === null || value === undefined;
    return value;
  }

  // =====================================================
  // Type-Safe Getters
  // =====================================================

  /**
   * Returns true if the last value read was SQL NULL.
   */
  wasNull(): boolean {
    return this.lastWasNull;
  }

  /**
   * Gets a string value.
   */
  getString(columnIndexOrLabel: number | string): string | null {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return null;
    }
    return String(value);
  }

  /**
   * Gets a boolean value.
   */
  getBoolean(columnIndexOrLabel: number | string): boolean {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      return lower === 'true' || lower === '1' || lower === 'yes';
    }
    return Boolean(value);
  }

  /**
   * Gets a byte value.
   */
  getByte(columnIndexOrLabel: number | string): number {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return 0;
    }
    const num = Number(value);
    return Math.max(-128, Math.min(127, Math.trunc(num)));
  }

  /**
   * Gets a short (16-bit integer) value.
   */
  getShort(columnIndexOrLabel: number | string): number {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return 0;
    }
    const num = Number(value);
    return Math.max(-32768, Math.min(32767, Math.trunc(num)));
  }

  /**
   * Gets an int (32-bit integer) value.
   */
  getInt(columnIndexOrLabel: number | string): number {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return 0;
    }
    const num = Number(value);
    return Math.trunc(num);
  }

  /**
   * Gets a long (64-bit integer) value.
   * Note: JavaScript numbers lose precision beyond 2^53, use BigInt for true 64-bit.
   */
  getLong(columnIndexOrLabel: number | string): number {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return Math.trunc(Number(value));
  }

  /**
   * Gets a float value.
   */
  getFloat(columnIndexOrLabel: number | string): number {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return 0.0;
    }
    return Number(value);
  }

  /**
   * Gets a double value.
   */
  getDouble(columnIndexOrLabel: number | string): number {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return 0.0;
    }
    return Number(value);
  }

  /**
   * Gets a BigDecimal value as a string (JavaScript doesn't have native BigDecimal).
   * For precise decimal arithmetic, use a library like decimal.js.
   */
  getBigDecimal(columnIndexOrLabel: number | string, _scale?: number): string | null {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return null;
    }
    return String(value);
  }

  /**
   * Gets bytes as a Buffer.
   */
  getBytes(columnIndexOrLabel: number | string): Buffer | null {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return null;
    }
    if (Buffer.isBuffer(value)) {
      return value;
    }
    if (typeof value === 'string') {
      return Buffer.from(value, 'utf-8');
    }
    return Buffer.from(String(value));
  }

  /**
   * Gets a Date value.
   */
  getDate(columnIndexOrLabel: number | string, _calendar?: unknown): Date | null {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    return new Date(value as string | number);
  }

  /**
   * Gets a Time value (as Date).
   */
  getTime(columnIndexOrLabel: number | string, _calendar?: unknown): Date | null {
    return this.getDate(columnIndexOrLabel);
  }

  /**
   * Gets a Timestamp value (as Date).
   */
  getTimestamp(columnIndexOrLabel: number | string, _calendar?: unknown): Date | null {
    return this.getDate(columnIndexOrLabel);
  }

  /**
   * Gets an object value without type conversion.
   */
  getObject(columnIndexOrLabel: number | string, _typeMap?: unknown): unknown {
    return this.getValue(columnIndexOrLabel);
  }

  /**
   * Gets a URL value.
   */
  getURL(columnIndexOrLabel: number | string): URL | null {
    const value = this.getValue(columnIndexOrLabel);
    if (value === null || value === undefined) {
      return null;
    }
    try {
      return new URL(String(value));
    } catch {
      return null;
    }
  }

  // =====================================================
  // Metadata
  // =====================================================

  /**
   * Gets the result set metadata.
   */
  getMetaData(): RowSetMetaData {
    const columns = this.columns;
    return {
      getColumnCount(): number {
        return columns.length;
      },
      getColumnName(column: number): string {
        const col = columns.find((c) => c.columnIndex === column);
        if (!col) {
          throw new Error(`Invalid column index: ${column}`);
        }
        return col.columnName;
      },
      getColumnLabel(column: number): string {
        const col = columns.find((c) => c.columnIndex === column);
        if (!col) {
          throw new Error(`Invalid column index: ${column}`);
        }
        return col.columnLabel;
      },
      getColumnTypeName(column: number): string {
        const col = columns.find((c) => c.columnIndex === column);
        if (!col) {
          throw new Error(`Invalid column index: ${column}`);
        }
        return col.columnTypeName;
      },
    };
  }

  // =====================================================
  // Collection Methods
  // =====================================================

  /**
   * Returns all values from a column as an array.
   */
  toCollection(columnIndexOrLabel: number | string): unknown[] {
    const columnIndex = this.getColumnIndex(columnIndexOrLabel);
    const column = this.columns.find((c) => c.columnIndex === columnIndex);

    if (!column) {
      throw new Error(`Invalid column index: ${columnIndex}`);
    }

    return this.rows.map((row) => row[column.columnLabel] ?? row[column.columnName]);
  }

  /**
   * Returns all rows as an array of objects.
   */
  toArray(): Record<string, unknown>[] {
    return [...this.rows];
  }

  // =====================================================
  // Iterable Support
  // =====================================================

  /**
   * Allows iteration with for...of loops.
   * Each iteration yields the current row after calling next().
   */
  *[Symbol.iterator](): Iterator<Record<string, unknown>> {
    this.beforeFirst();
    while (this.next()) {
      yield this.rows[this.currentRowIndex]!;
    }
  }
}
