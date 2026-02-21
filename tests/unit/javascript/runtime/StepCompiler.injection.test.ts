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
});
