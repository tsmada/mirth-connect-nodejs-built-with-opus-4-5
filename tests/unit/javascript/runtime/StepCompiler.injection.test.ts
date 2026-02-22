import { compileFilterRule } from '../../../../src/javascript/runtime/StepCompiler';

describe('StepCompiler injection prevention', () => {
  it('should compile normal field access', () => {
    const result = compileFilterRule('com.mirth.RuleBuilderRule', {
      field: "msg['PID']['PID.5']",
      condition: 'EXISTS',
      values: null,
    });
    expect(result).toBe("msg['PID']['PID.5'].toString().length > 0");
  });

  it('should reject field with semicolons (injection attempt)', () => {
    expect(() => {
      compileFilterRule('com.mirth.RuleBuilderRule', {
        field: "x); $g.put('leak', channelMap); (0",
        condition: 'EXISTS',
        values: null,
      });
    }).toThrow(/prohibited characters/);
  });

  it('should compile field with special characters in brackets', () => {
    const result = compileFilterRule('com.mirth.RuleBuilderRule', {
      field: "msg['PID.5.1']",
      condition: 'EQUALS',
      values: { string: 'DOE' },
    });
    expect(result).toContain("msg['PID.5.1'].toString()");
    expect(result).toContain("'DOE'");
  });

  it('should reject field with curly braces', () => {
    expect(() => {
      compileFilterRule('com.mirth.RuleBuilderRule', {
        field: "x} function evil() { return globalMap",
        condition: 'EXISTS',
        values: null,
      });
    }).toThrow(/prohibited characters/);
  });

  it('should reject field with comment injection', () => {
    expect(() => {
      compileFilterRule('com.mirth.RuleBuilderRule', {
        field: "x // comment\nmalicious()",
        condition: 'EXISTS',
        values: null,
      });
    }).toThrow(/prohibited characters/);
  });

  describe('escapeJsString completeness', () => {
    it('should produce valid JS when value contains newline', () => {
      const result = compileFilterRule('com.mirth.RuleBuilderRule', {
        field: "msg['PID']['PID.5']",
        condition: 'EQUALS',
        values: { string: 'line1\nline2' },
      });
      // The generated code should have escaped newlines, not literal ones
      expect(result).not.toContain('\n');
      expect(result).toContain('\\n');
      // Verify it's valid JavaScript by evaluating it
      expect(() => new Function(`var msg = {'PID': {'PID.5': {toString: function() { return 'line1\\nline2'; }}}}; return ${result};`)).not.toThrow();
    });

    it('should produce valid JS when value contains carriage return', () => {
      const result = compileFilterRule('com.mirth.RuleBuilderRule', {
        field: "msg['PID']['PID.5']",
        condition: 'CONTAINS',
        values: { string: 'val\rwith\rcr' },
      });
      // No literal carriage returns in generated code
      expect(result).not.toContain('\r');
      expect(result).toContain('\\r');
    });

    it('should produce valid JS when value contains null byte', () => {
      const result = compileFilterRule('com.mirth.RuleBuilderRule', {
        field: "msg['PID']['PID.5']",
        condition: 'EQUALS',
        values: { string: 'before\0after' },
      });
      // No literal null bytes in generated code
      expect(result).not.toContain('\0');
      expect(result).toContain('\\0');
    });

    it('should handle backslash + single quote together', () => {
      const result = compileFilterRule('com.mirth.RuleBuilderRule', {
        field: "msg['PID']['PID.5']",
        condition: 'EQUALS',
        values: { string: "it\\'s a test" },
      });
      // Should be valid JS — no unescaped quotes or backslashes
      expect(() => new Function(`return ${result}`)).not.toThrow();
    });

    it('should handle all escape characters combined', () => {
      const result = compileFilterRule('com.mirth.RuleBuilderRule', {
        field: "msg['OBX']['OBX.5']",
        condition: 'NOT_CONTAIN',
        values: { string: "line1\nline2\rend\0" },
      });
      // Generated code must not contain raw control characters
      expect(result).not.toMatch(/[\n\r\0]/);
    });
  });
});
