import { MirthCachedRowSet } from '../../../../src/javascript/userutil/MirthCachedRowSet';

describe('MirthCachedRowSet', () => {
  // Sample data for testing
  const sampleColumns = [
    { name: 'id', type: 'INT' },
    { name: 'name', type: 'VARCHAR' },
    { name: 'email', type: 'VARCHAR' },
    { name: 'age', type: 'INT' },
    { name: 'active', type: 'BOOLEAN' },
    { name: 'created_at', type: 'DATETIME' },
    { name: 'balance', type: 'DECIMAL' },
  ];

  const sampleRows = [
    {
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      age: 30,
      active: true,
      created_at: new Date('2024-01-15'),
      balance: '1234.56',
    },
    {
      id: 2,
      name: 'Bob',
      email: 'bob@example.com',
      age: 25,
      active: false,
      created_at: new Date('2024-02-20'),
      balance: '789.00',
    },
    {
      id: 3,
      name: 'Charlie',
      email: null,
      age: 35,
      active: true,
      created_at: new Date('2024-03-10'),
      balance: null,
    },
  ];

  let rowSet: MirthCachedRowSet;

  beforeEach(() => {
    rowSet = new MirthCachedRowSet();
    rowSet.populate(sampleRows, sampleColumns);
  });

  describe('populate', () => {
    it('should populate with rows and columns', () => {
      expect(rowSet.size()).toBe(3);
      expect(rowSet.isEmpty()).toBe(false);
    });

    it('should handle empty data', () => {
      const emptyRowSet = new MirthCachedRowSet();
      emptyRowSet.populate([], []);

      expect(emptyRowSet.size()).toBe(0);
      expect(emptyRowSet.isEmpty()).toBe(true);
    });
  });

  describe('cursor movement', () => {
    describe('next', () => {
      it('should move to first row from initial position', () => {
        expect(rowSet.next()).toBe(true);
        expect(rowSet.getRow()).toBe(1);
      });

      it('should move through all rows', () => {
        expect(rowSet.next()).toBe(true); // Row 1
        expect(rowSet.next()).toBe(true); // Row 2
        expect(rowSet.next()).toBe(true); // Row 3
        expect(rowSet.next()).toBe(false); // No more rows
      });

      it('should return false on empty set', () => {
        const emptyRowSet = new MirthCachedRowSet();
        emptyRowSet.populate([], []);

        expect(emptyRowSet.next()).toBe(false);
      });
    });

    describe('previous', () => {
      it('should move to previous row', () => {
        rowSet.last();
        expect(rowSet.previous()).toBe(true);
        expect(rowSet.getRow()).toBe(2);
      });

      it('should return false when at first row', () => {
        rowSet.first();
        expect(rowSet.previous()).toBe(false);
      });
    });

    describe('first and last', () => {
      it('should move to first row', () => {
        expect(rowSet.first()).toBe(true);
        expect(rowSet.getRow()).toBe(1);
        expect(rowSet.isFirst()).toBe(true);
      });

      it('should move to last row', () => {
        expect(rowSet.last()).toBe(true);
        expect(rowSet.getRow()).toBe(3);
        expect(rowSet.isLast()).toBe(true);
      });

      it('should return false for empty set', () => {
        const emptyRowSet = new MirthCachedRowSet();
        emptyRowSet.populate([], []);

        expect(emptyRowSet.first()).toBe(false);
        expect(emptyRowSet.last()).toBe(false);
      });
    });

    describe('absolute', () => {
      it('should move to absolute row (1-based)', () => {
        expect(rowSet.absolute(2)).toBe(true);
        expect(rowSet.getRow()).toBe(2);
      });

      it('should move to row from end with negative number', () => {
        expect(rowSet.absolute(-1)).toBe(true);
        expect(rowSet.getRow()).toBe(3); // Last row
      });

      it('should return false for row 0', () => {
        expect(rowSet.absolute(0)).toBe(false);
        expect(rowSet.getRow()).toBe(0); // Before first
      });

      it('should return false for out of range', () => {
        expect(rowSet.absolute(100)).toBe(false);
      });
    });

    describe('relative', () => {
      it('should move forward relative to current position', () => {
        rowSet.first();
        expect(rowSet.relative(2)).toBe(true);
        expect(rowSet.getRow()).toBe(3);
      });

      it('should move backward relative to current position', () => {
        rowSet.last();
        expect(rowSet.relative(-2)).toBe(true);
        expect(rowSet.getRow()).toBe(1);
      });
    });

    describe('beforeFirst and afterLast', () => {
      it('should position before first row', () => {
        rowSet.first();
        rowSet.beforeFirst();

        expect(rowSet.isBeforeFirst()).toBe(true);
        expect(rowSet.getRow()).toBe(0);
      });

      it('should position after last row', () => {
        rowSet.first();
        rowSet.afterLast();

        expect(rowSet.isAfterLast()).toBe(true);
        expect(rowSet.getRow()).toBe(0);
      });
    });
  });

  describe('type-safe getters', () => {
    beforeEach(() => {
      rowSet.first();
    });

    describe('getString', () => {
      it('should get string by column index', () => {
        expect(rowSet.getString(2)).toBe('Alice');
      });

      it('should get string by column name', () => {
        expect(rowSet.getString('name')).toBe('Alice');
      });

      it('should get string by column name (case-insensitive)', () => {
        expect(rowSet.getString('NAME')).toBe('Alice');
        expect(rowSet.getString('Name')).toBe('Alice');
      });

      it('should return null for null values', () => {
        rowSet.absolute(3); // Charlie has null email
        expect(rowSet.getString('email')).toBeNull();
        expect(rowSet.wasNull()).toBe(true);
      });

      it('should convert numbers to strings', () => {
        expect(rowSet.getString('id')).toBe('1');
        expect(rowSet.getString('age')).toBe('30');
      });
    });

    describe('getInt', () => {
      it('should get integer value', () => {
        expect(rowSet.getInt('id')).toBe(1);
        expect(rowSet.getInt('age')).toBe(30);
      });

      it('should return 0 for null', () => {
        rowSet.absolute(3);
        // Make a null age for testing
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ value: null }],
          [{ name: 'value', type: 'INT' }]
        );
        testRowSet.first();

        expect(testRowSet.getInt('value')).toBe(0);
      });

      it('should truncate decimals', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ value: 123.99 }],
          [{ name: 'value', type: 'DECIMAL' }]
        );
        testRowSet.first();

        expect(testRowSet.getInt('value')).toBe(123);
      });
    });

    describe('getBoolean', () => {
      it('should get boolean value', () => {
        expect(rowSet.getBoolean('active')).toBe(true);

        rowSet.next();
        expect(rowSet.getBoolean('active')).toBe(false);
      });

      it('should convert truthy values', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [
            { val: 1 },
            { val: 0 },
            { val: 'true' },
            { val: 'false' },
            { val: 'yes' },
            { val: '1' },
          ],
          [{ name: 'val', type: 'VARCHAR' }]
        );

        testRowSet.next();
        expect(testRowSet.getBoolean('val')).toBe(true);
        testRowSet.next();
        expect(testRowSet.getBoolean('val')).toBe(false);
        testRowSet.next();
        expect(testRowSet.getBoolean('val')).toBe(true);
        testRowSet.next();
        expect(testRowSet.getBoolean('val')).toBe(false);
        testRowSet.next();
        expect(testRowSet.getBoolean('val')).toBe(true);
        testRowSet.next();
        expect(testRowSet.getBoolean('val')).toBe(true);
      });

      it('should return false for null', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ val: null }],
          [{ name: 'val', type: 'BOOLEAN' }]
        );
        testRowSet.first();

        expect(testRowSet.getBoolean('val')).toBe(false);
      });
    });

    describe('getDouble', () => {
      it('should get decimal value', () => {
        // Balance is stored as string '1234.56'
        expect(rowSet.getDouble('balance')).toBe(1234.56);
      });

      it('should return 0 for null', () => {
        rowSet.absolute(3);
        expect(rowSet.getDouble('balance')).toBe(0);
      });
    });

    describe('getBigDecimal', () => {
      it('should return decimal as string', () => {
        expect(rowSet.getBigDecimal('balance')).toBe('1234.56');
      });

      it('should return null for null values', () => {
        rowSet.absolute(3);
        expect(rowSet.getBigDecimal('balance')).toBeNull();
      });
    });

    describe('getDate', () => {
      it('should get date value', () => {
        const date = rowSet.getDate('created_at');
        expect(date).toBeInstanceOf(Date);
        // Use UTC methods to avoid timezone issues
        expect(date?.getUTCFullYear()).toBe(2024);
        expect(date?.getUTCMonth()).toBe(0); // January
        expect(date?.getUTCDate()).toBe(15);
      });

      it('should parse date strings', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ dt: '2024-06-15T10:30:00Z' }],
          [{ name: 'dt', type: 'DATETIME' }]
        );
        testRowSet.first();

        const date = testRowSet.getDate('dt');
        expect(date).toBeInstanceOf(Date);
        expect(date?.getFullYear()).toBe(2024);
        expect(date?.getMonth()).toBe(5); // June
      });

      it('should return null for null values', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ dt: null }],
          [{ name: 'dt', type: 'DATETIME' }]
        );
        testRowSet.first();

        expect(testRowSet.getDate('dt')).toBeNull();
      });
    });

    describe('getObject', () => {
      it('should return raw value without conversion', () => {
        expect(rowSet.getObject('id')).toBe(1);
        expect(rowSet.getObject('name')).toBe('Alice');
        expect(rowSet.getObject('active')).toBe(true);
      });
    });

    describe('getBytes', () => {
      it('should return Buffer for string values', () => {
        const bytes = rowSet.getBytes('name');
        expect(bytes).toBeInstanceOf(Buffer);
        expect(bytes?.toString()).toBe('Alice');
      });

      it('should return Buffer for buffer values', () => {
        const testRowSet = new MirthCachedRowSet();
        const originalBuffer = Buffer.from([0x01, 0x02, 0x03]);
        testRowSet.populate(
          [{ data: originalBuffer }],
          [{ name: 'data', type: 'BLOB' }]
        );
        testRowSet.first();

        const bytes = testRowSet.getBytes('data');
        expect(bytes).toEqual(originalBuffer);
      });

      it('should return null for null values', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ data: null }],
          [{ name: 'data', type: 'BLOB' }]
        );
        testRowSet.first();

        expect(testRowSet.getBytes('data')).toBeNull();
      });
    });

    describe('getByte and getShort', () => {
      it('should clamp byte values', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ val: 200 }, { val: -200 }, { val: 100 }],
          [{ name: 'val', type: 'INT' }]
        );

        testRowSet.next();
        expect(testRowSet.getByte('val')).toBe(127); // Clamped

        testRowSet.next();
        expect(testRowSet.getByte('val')).toBe(-128); // Clamped

        testRowSet.next();
        expect(testRowSet.getByte('val')).toBe(100); // Within range
      });

      it('should clamp short values', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ val: 50000 }, { val: -50000 }],
          [{ name: 'val', type: 'INT' }]
        );

        testRowSet.next();
        expect(testRowSet.getShort('val')).toBe(32767); // Clamped

        testRowSet.next();
        expect(testRowSet.getShort('val')).toBe(-32768); // Clamped
      });
    });

    describe('getURL', () => {
      it('should parse valid URLs', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ url: 'https://example.com/path?query=1' }],
          [{ name: 'url', type: 'VARCHAR' }]
        );
        testRowSet.first();

        const url = testRowSet.getURL('url');
        expect(url).toBeInstanceOf(URL);
        expect(url?.hostname).toBe('example.com');
        expect(url?.pathname).toBe('/path');
      });

      it('should return null for invalid URLs', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ url: 'not a valid url' }],
          [{ name: 'url', type: 'VARCHAR' }]
        );
        testRowSet.first();

        expect(testRowSet.getURL('url')).toBeNull();
      });

      it('should return null for null values', () => {
        const testRowSet = new MirthCachedRowSet();
        testRowSet.populate(
          [{ url: null }],
          [{ name: 'url', type: 'VARCHAR' }]
        );
        testRowSet.first();

        expect(testRowSet.getURL('url')).toBeNull();
      });
    });
  });

  describe('findColumn', () => {
    it('should find column by name (case-insensitive)', () => {
      expect(rowSet.findColumn('name')).toBe(2);
      expect(rowSet.findColumn('NAME')).toBe(2);
      expect(rowSet.findColumn('Name')).toBe(2);
    });

    it('should throw for unknown column', () => {
      expect(() => rowSet.findColumn('nonexistent')).toThrow(
        'Invalid column name: nonexistent'
      );
    });
  });

  describe('metadata', () => {
    it('should return metadata with column count', () => {
      const meta = rowSet.getMetaData();
      expect(meta.getColumnCount()).toBe(7);
    });

    it('should return column name by index', () => {
      const meta = rowSet.getMetaData();
      expect(meta.getColumnName(1)).toBe('id');
      expect(meta.getColumnName(2)).toBe('name');
    });

    it('should return column label by index', () => {
      const meta = rowSet.getMetaData();
      expect(meta.getColumnLabel(1)).toBe('id');
    });

    it('should return column type name', () => {
      const meta = rowSet.getMetaData();
      expect(meta.getColumnTypeName(1)).toBe('INT');
      expect(meta.getColumnTypeName(2)).toBe('VARCHAR');
    });

    it('should throw for invalid column index', () => {
      const meta = rowSet.getMetaData();
      expect(() => meta.getColumnName(100)).toThrow('Invalid column index: 100');
    });
  });

  describe('wasNull', () => {
    it('should return false after reading non-null value', () => {
      rowSet.first();
      rowSet.getString('name');
      expect(rowSet.wasNull()).toBe(false);
    });

    it('should return true after reading null value', () => {
      rowSet.absolute(3); // Charlie has null email
      rowSet.getString('email');
      expect(rowSet.wasNull()).toBe(true);
    });
  });

  describe('toCollection', () => {
    it('should return all values from a column', () => {
      const names = rowSet.toCollection('name');
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('should return values by column index', () => {
      const ids = rowSet.toCollection(1);
      expect(ids).toEqual([1, 2, 3]);
    });

    it('should include null values', () => {
      const emails = rowSet.toCollection('email');
      expect(emails).toEqual(['alice@example.com', 'bob@example.com', null]);
    });
  });

  describe('toArray', () => {
    it('should return all rows as array', () => {
      const rows = rowSet.toArray();
      expect(rows.length).toBe(3);
      expect(rows[0]!.name).toBe('Alice');
      expect(rows[1]!.name).toBe('Bob');
      expect(rows[2]!.name).toBe('Charlie');
    });
  });

  describe('iterator', () => {
    it('should support for...of iteration', () => {
      const names: string[] = [];
      for (const row of rowSet) {
        names.push(row.name as string);
      }
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('should allow multiple iterations', () => {
      const firstPass: string[] = [];
      const secondPass: string[] = [];

      for (const row of rowSet) {
        firstPass.push(row.name as string);
      }

      for (const row of rowSet) {
        secondPass.push(row.name as string);
      }

      expect(firstPass).toEqual(secondPass);
    });
  });

  describe('error handling', () => {
    it('should throw when accessing row before positioning cursor', () => {
      expect(() => rowSet.getString('name')).toThrow('Invalid cursor position');
    });

    it('should throw for invalid column index', () => {
      rowSet.first();
      expect(() => rowSet.getString(100)).toThrow('Invalid column index: 100');
    });
  });
});
