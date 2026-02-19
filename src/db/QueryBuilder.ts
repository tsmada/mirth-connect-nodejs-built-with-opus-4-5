/**
 * Dynamic SQL Query Builder
 *
 * Provides utilities for building dynamic WHERE clauses and SQL queries
 * in a safe, parameterized way.
 *
 * Key features:
 * - Named parameter placeholders (:paramName)
 * - Dynamic condition building
 * - Safe escaping for LIKE patterns
 * - Support for IN clauses with multiple values
 * - Pagination support
 */

// ============================================================================
// Query Result Type
// ============================================================================

export interface QueryResult {
  /** SQL query string with named placeholders */
  sql: string;
  /** Parameter values keyed by placeholder name */
  params: Record<string, unknown>;
}

// ============================================================================
// Query Builder Class
// ============================================================================

export class QueryBuilder {
  private selectClause: string = 'SELECT *';
  private fromClause: string = '';
  private conditions: string[] = [];
  private params: Record<string, unknown> = {};
  private orderByClause: string = '';
  private limitValue?: number;
  private offsetValue?: number;
  private paramCounter: number = 0;

  /**
   * Create a new query builder
   */
  constructor(tableName?: string) {
    if (tableName) {
      this.fromClause = `FROM ${tableName}`;
    }
  }

  /**
   * Set SELECT clause
   */
  select(columns: string | string[]): this {
    if (Array.isArray(columns)) {
      this.selectClause = `SELECT ${columns.join(', ')}`;
    } else {
      this.selectClause = `SELECT ${columns}`;
    }
    return this;
  }

  /**
   * Set FROM clause
   */
  from(tableName: string, alias?: string): this {
    this.fromClause = alias ? `FROM ${tableName} ${alias}` : `FROM ${tableName}`;
    return this;
  }

  /**
   * Add a raw WHERE condition with a parameter
   */
  where(condition: string, paramName: string, paramValue: unknown): this {
    this.conditions.push(condition);
    this.params[paramName] = paramValue;
    return this;
  }

  /**
   * Add a condition only if value is defined
   */
  whereIf(
    condition: string,
    paramName: string,
    value: unknown,
    transform?: (v: unknown) => unknown
  ): this {
    if (value !== undefined && value !== null) {
      const transformedValue = transform ? transform(value) : value;
      return this.where(condition, paramName, transformedValue);
    }
    return this;
  }

  /**
   * Add an equality condition
   */
  whereEquals(column: string, value: unknown): this {
    if (value !== undefined && value !== null) {
      const paramName = this.nextParamName();
      this.conditions.push(`${column} = :${paramName}`);
      this.params[paramName] = value;
    }
    return this;
  }

  /**
   * Add a >= condition
   */
  whereGreaterOrEqual(column: string, value: unknown): this {
    if (value !== undefined && value !== null) {
      const paramName = this.nextParamName();
      this.conditions.push(`${column} >= :${paramName}`);
      this.params[paramName] = value;
    }
    return this;
  }

  /**
   * Add a <= condition
   */
  whereLessOrEqual(column: string, value: unknown): this {
    if (value !== undefined && value !== null) {
      const paramName = this.nextParamName();
      this.conditions.push(`${column} <= :${paramName}`);
      this.params[paramName] = value;
    }
    return this;
  }

  /**
   * Add a > condition
   */
  whereGreater(column: string, value: unknown): this {
    if (value !== undefined && value !== null) {
      const paramName = this.nextParamName();
      this.conditions.push(`${column} > :${paramName}`);
      this.params[paramName] = value;
    }
    return this;
  }

  /**
   * Add a < condition
   */
  whereLess(column: string, value: unknown): this {
    if (value !== undefined && value !== null) {
      const paramName = this.nextParamName();
      this.conditions.push(`${column} < :${paramName}`);
      this.params[paramName] = value;
    }
    return this;
  }

  /**
   * Add a LIKE condition (case-insensitive)
   */
  whereLike(
    column: string,
    pattern: string | undefined,
    position: 'start' | 'end' | 'both' = 'both'
  ): this {
    if (pattern !== undefined && pattern !== null && pattern.trim() !== '') {
      const paramName = this.nextParamName();
      this.conditions.push(`LOWER(${column}) LIKE LOWER(:${paramName})`);

      let likePattern: string;
      switch (position) {
        case 'start':
          likePattern = `${escapeLikePattern(pattern)}%`;
          break;
        case 'end':
          likePattern = `%${escapeLikePattern(pattern)}`;
          break;
        case 'both':
        default:
          likePattern = `%${escapeLikePattern(pattern)}%`;
          break;
      }
      this.params[paramName] = likePattern;
    }
    return this;
  }

  /**
   * Add an IN clause
   */
  whereIn(column: string, values: unknown[] | undefined): this {
    if (values !== undefined && values.length > 0) {
      const placeholders = values.map((_, i) => {
        const paramName = `${column.replace(/\./g, '_')}_${i}`;
        this.params[paramName] = values[i];
        return `:${paramName}`;
      });
      this.conditions.push(`${column} IN (${placeholders.join(', ')})`);
    }
    return this;
  }

  /**
   * Add a NOT IN clause
   */
  whereNotIn(column: string, values: unknown[] | undefined): this {
    if (values !== undefined && values.length > 0) {
      const placeholders = values.map((_, i) => {
        const paramName = `${column.replace(/\./g, '_')}_not_${i}`;
        this.params[paramName] = values[i];
        return `:${paramName}`;
      });
      this.conditions.push(`${column} NOT IN (${placeholders.join(', ')})`);
    }
    return this;
  }

  /**
   * Add an EXISTS subquery condition
   */
  whereExists(subquery: string): this {
    this.conditions.push(`EXISTS (${subquery})`);
    return this;
  }

  /**
   * Add a raw condition (no parameter)
   */
  whereRaw(condition: string): this {
    this.conditions.push(condition);
    return this;
  }

  /**
   * Add ORDER BY clause
   */
  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderByClause = `ORDER BY ${column} ${direction}`;
    return this;
  }

  /**
   * Set LIMIT
   */
  limit(value: number | undefined): this {
    this.limitValue = value;
    return this;
  }

  /**
   * Set OFFSET
   */
  offset(value: number | undefined): this {
    this.offsetValue = value;
    return this;
  }

  /**
   * Build the final query
   */
  build(): QueryResult {
    let sql = `${this.selectClause} ${this.fromClause}`;

    if (this.conditions.length > 0) {
      sql += ' WHERE ' + this.conditions.join(' AND ');
    }

    if (this.orderByClause) {
      sql += ' ' + this.orderByClause;
    }

    if (this.limitValue !== undefined) {
      sql += ` LIMIT ${this.limitValue}`;
    }

    if (this.offsetValue !== undefined) {
      sql += ` OFFSET ${this.offsetValue}`;
    }

    return { sql, params: this.params };
  }

  /**
   * Build a COUNT query
   */
  buildCount(): QueryResult {
    let sql = `SELECT COUNT(*) as count ${this.fromClause}`;

    if (this.conditions.length > 0) {
      sql += ' WHERE ' + this.conditions.join(' AND ');
    }

    return { sql, params: this.params };
  }

  /**
   * Get current parameters
   */
  getParams(): Record<string, unknown> {
    return { ...this.params };
  }

  /**
   * Add a parameter manually
   */
  addParam(name: string, value: unknown): this {
    this.params[name] = value;
    return this;
  }

  /**
   * Generate next unique parameter name
   */
  private nextParamName(): string {
    return `p${this.paramCounter++}`;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Escape special characters in LIKE patterns
 */
export function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[%_\\]/g, '\\$&');
}

/**
 * Convert metadata operator to SQL
 */
export function operatorToSQL(operator: string, _ignoreCase?: boolean): string {
  // Note: ignoreCase parameter reserved for future use with UPPER() wrapping
  switch (operator) {
    case 'EQUAL':
      return '=';
    case 'NOT_EQUAL':
      return '!=';
    case 'LESS_THAN':
      return '<';
    case 'LESS_THAN_OR_EQUAL':
      return '<=';
    case 'GREATER_THAN':
      return '>';
    case 'GREATER_THAN_OR_EQUAL':
      return '>=';
    case 'CONTAINS':
    case 'STARTS_WITH':
    case 'ENDS_WITH':
      return 'LIKE';
    case 'DOES_NOT_CONTAIN':
    case 'DOES_NOT_START_WITH':
    case 'DOES_NOT_END_WITH':
      return 'NOT LIKE';
    default:
      return '=';
  }
}

/**
 * Format value for LIKE operator based on type
 */
export function formatLikeValue(operator: string, value: string): string {
  const escaped = escapeLikePattern(value);
  switch (operator) {
    case 'CONTAINS':
    case 'DOES_NOT_CONTAIN':
      return `%${escaped}%`;
    case 'STARTS_WITH':
    case 'DOES_NOT_START_WITH':
      return `${escaped}%`;
    case 'ENDS_WITH':
    case 'DOES_NOT_END_WITH':
      return `%${escaped}`;
    default:
      return value;
  }
}

/**
 * Parse date from various formats
 */
export function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  if (typeof value === 'string') {
    // Try ISO format first
    const isoDate = new Date(value);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    // Try epoch milliseconds
    const epoch = parseInt(value, 10);
    if (!isNaN(epoch)) {
      return new Date(epoch);
    }
  }

  return undefined;
}

/**
 * Format date for MySQL DATETIME column
 */
export function formatDateForSQL(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// ============================================================================
// Pagination Helper
// ============================================================================

export interface PaginationOptions {
  offset?: number;
  limit?: number;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface PaginationResult {
  offset: number;
  limit: number;
}

/**
 * Normalize pagination parameters
 */
export function normalizePagination(options: PaginationOptions): PaginationResult {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 1000;

  let offset = options.offset ?? 0;
  let limit = options.limit ?? defaultLimit;

  // Ensure non-negative
  offset = Math.max(0, offset);
  limit = Math.max(1, Math.min(limit, maxLimit));

  return { offset, limit };
}
