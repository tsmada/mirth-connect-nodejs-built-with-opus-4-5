import { compileTransformerStep, compileFilterRule } from '../../../../src/javascript/runtime/StepCompiler';

describe('StepCompiler', () => {
  describe('compileTransformerStep', () => {
    describe('MapperStep compilation', () => {
      it('should compile a basic mapper step to channelMap.put with validate', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.mapper.MapperStep',
          {
            variable: 'patientMRN',
            mapping: "msg['PID']['PID.3']['PID.3.1'].toString()",
            defaultValue: "''",
            scope: 'CHANNEL',
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("channelMap.put('patientMRN'");
        expect(result).toContain('validate(');
        expect(result).toContain("msg['PID']['PID.3']['PID.3.1'].toString()");
      });

      it('should use globalMap for GLOBAL scope', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.mapper.MapperStep',
          {
            variable: 'globalVar',
            mapping: "'test'",
            defaultValue: "''",
            scope: 'GLOBAL',
          }
        );

        expect(result).toContain("globalMap.put('globalVar'");
      });

      it('should use responseMap for RESPONSE scope', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.mapper.MapperStep',
          {
            variable: 'respVar',
            mapping: "'response'",
            defaultValue: "''",
            scope: 'RESPONSE',
          }
        );

        expect(result).toContain("responseMap.put('respVar'");
      });

      it('should use connectorMap for CONNECTOR scope', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.mapper.MapperStep',
          {
            variable: 'connVar',
            mapping: "'test'",
            defaultValue: "''",
            scope: 'CONNECTOR',
          }
        );

        expect(result).toContain("connectorMap.put('connVar'");
      });

      it('should use globalChannelMap for GLOBAL_CHANNEL scope', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.mapper.MapperStep',
          {
            variable: 'gcVar',
            mapping: "'test'",
            defaultValue: "''",
            scope: 'GLOBAL_CHANNEL',
          }
        );

        expect(result).toContain("globalChannelMap.put('gcVar'");
      });

      it('should handle replacements', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.mapper.MapperStep',
          {
            variable: 'cleanedField',
            mapping: "msg['PID']['PID.5'].toString()",
            defaultValue: "''",
            replacements: [
              { pattern: "'^'", replacement: "''" },
              { pattern: "'~'", replacement: "' '" },
            ],
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain('new Array');
        expect(result).toContain("channelMap.put('cleanedField'");
      });

      it('should match class name with short form "Mapper"', () => {
        const result = compileTransformerStep(
          'Mapper',
          {
            variable: 'test',
            mapping: "'val'",
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("channelMap.put('test'");
      });
    });

    describe('MessageBuilderStep compilation', () => {
      it('should compile to segment assignment with validate', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
          {
            messageSegment: "tmp['PID']['PID.3']['PID.3.1']",
            mapping: "'12345'",
            defaultValue: "''",
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("tmp['PID']['PID.3']['PID.3.1'] = validate(");
        expect(result).toContain("'12345'");
      });

      it('should match short class name "MessageBuilder"', () => {
        const result = compileTransformerStep(
          'MessageBuilder',
          {
            messageSegment: "msg['MSH']['MSH.9']",
            mapping: "'ADT^A01'",
            defaultValue: "''",
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("msg['MSH']['MSH.9'] = validate(");
      });

      it('should handle replacements in MessageBuilder', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
          {
            messageSegment: "tmp['PID']['PID.5']",
            mapping: "msg['PID']['PID.5'].toString()",
            defaultValue: "''",
            replacements: [{ pattern: "'^'", replacement: "''" }],
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain('new Array');
      });
    });

    describe('XsltStep compilation', () => {
      it('should compile to XsltTransformer.transform call', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.xsltstep.XsltStep',
          {
            sourceXml: 'msg.toString()',
            resultVariable: 'transformedXml',
            template: "'<xsl:stylesheet>...</xsl:stylesheet>'",
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain('XsltTransformer.transform');
        expect(result).toContain('msg.toString()');
        expect(result).toContain("channelMap.put('transformedXml'");
      });

      it('should match short class name "XSLT"', () => {
        const result = compileTransformerStep(
          'XSLT',
          {
            resultVariable: 'result',
            template: "'<xsl:stylesheet/>'",
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain('XsltTransformer.transform');
      });
    });

    describe('Unknown step types', () => {
      it('should return null for unknown step type', () => {
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.unknown.SomePlugin',
          { someField: 'value' }
        );

        expect(result).toBeNull();
      });

      it('should not match MessageBuilder when checking for Mapper', () => {
        // Ensure "MessageBuilder" doesn't accidentally match the Mapper branch
        const result = compileTransformerStep(
          'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
          {
            messageSegment: "tmp['PID']['PID.3']",
            mapping: "'test'",
          }
        );

        // Should be MessageBuilder output (assignment), not Mapper output (channelMap.put)
        expect(result).toContain("tmp['PID']['PID.3'] = validate(");
        expect(result).not.toContain('channelMap.put');
      });
    });
  });

  describe('compileFilterRule', () => {
    describe('RuleBuilderRule compilation', () => {
      it('should compile EXISTS condition', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['PID']['PID.3']['PID.3.1']",
            condition: 'EXISTS',
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("msg['PID']['PID.3']['PID.3.1'].toString().length > 0");
      });

      it('should compile NOT_EXIST condition', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['PID']['PID.5']",
            condition: 'NOT_EXIST',
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("!(msg['PID']['PID.5'].toString().length > 0)");
      });

      it('should compile EQUALS condition with single value', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['MSH']['MSH.9']['MSH.9.1']",
            condition: 'EQUALS',
            values: { string: 'ADT' },
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("msg['MSH']['MSH.9']['MSH.9.1'].toString() == 'ADT'");
      });

      it('should compile EQUALS condition with multiple values (OR)', () => {
        const result = compileFilterRule(
          'RuleBuilder',
          {
            field: "msg['MSH']['MSH.9']['MSH.9.2']",
            condition: 'EQUALS',
            values: { string: ['A01', 'A02', 'A03'] },
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("== 'A01'");
        expect(result).toContain("== 'A02'");
        expect(result).toContain("== 'A03'");
        expect(result).toContain(' || ');
      });

      it('should compile NOT_EQUAL condition with multiple values (AND)', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['EVN']['EVN.1']",
            condition: 'NOT_EQUAL',
            values: { string: ['A04', 'A05'] },
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("!= 'A04'");
        expect(result).toContain("!= 'A05'");
        expect(result).toContain(' && ');
      });

      it('should compile CONTAINS condition', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['PID']['PID.5'].toString()",
            condition: 'CONTAINS',
            values: { string: 'SMITH' },
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain(".indexOf('SMITH') >= 0");
      });

      it('should compile NOT_CONTAIN condition', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['PID']['PID.3']",
            condition: 'NOT_CONTAIN',
            values: { string: ['TEST', 'DUMMY'] },
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain(".indexOf('TEST') < 0");
        expect(result).toContain(".indexOf('DUMMY') < 0");
        expect(result).toContain(' && ');
      });

      it('should return true for conditions with empty values', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['PID']['PID.3']",
            condition: 'EQUALS',
            values: null,
          }
        );

        expect(result).toBe('true');
      });

      it('should default to EXISTS when condition is missing', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['PID']['PID.3']",
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain('.toString().length > 0');
      });

      it('should handle values as a plain array', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['MSH']['MSH.9']",
            condition: 'EQUALS',
            values: ['ADT', 'ORM'],
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("== 'ADT'");
        expect(result).toContain("== 'ORM'");
      });

      it('should escape single quotes in values', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['PID']['PID.5']",
            condition: 'EQUALS',
            values: { string: "O'Brien" },
          }
        );

        expect(result).not.toBeNull();
        expect(result).toContain("O\\'Brien");
      });

      it('should return true for unknown condition types', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
          {
            field: "msg['PID']['PID.3']",
            condition: 'STARTS_WITH',
            values: { string: 'A' },
          }
        );

        expect(result).toBe('true');
      });
    });

    describe('Unknown rule types', () => {
      it('should return null for unknown rule type', () => {
        const result = compileFilterRule(
          'com.mirth.connect.plugins.unknown.SomeRule',
          { someField: 'value' }
        );

        expect(result).toBeNull();
      });
    });
  });
});
