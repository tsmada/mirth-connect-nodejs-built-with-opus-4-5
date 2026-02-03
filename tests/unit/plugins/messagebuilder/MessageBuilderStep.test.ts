import {
  MessageBuilderStep,
  MESSAGE_BUILDER_STEP_PLUGIN_POINT,
  createMessageBuilderStep,
  isMessageBuilderStep,
  isMessageBuilderStepType,
} from '../../../../src/plugins/messagebuilder/MessageBuilderStep';

describe('MessageBuilderStep', () => {
  describe('constructor', () => {
    it('should create step with default values', () => {
      const step = new MessageBuilderStep();

      expect(step.getSequenceNumber()).toBe(0);
      expect(step.getName()).toBe('');
      expect(step.isEnabled()).toBe(true);
      expect(step.getMessageSegment()).toBe('');
      expect(step.getMapping()).toBe('');
      expect(step.getDefaultValue()).toBe('');
      expect(step.getReplacements()).toEqual([]);
      expect(step.getType()).toBe('Message Builder');
    });

    it('should create step with provided values', () => {
      const step = new MessageBuilderStep({
        sequenceNumber: 1,
        name: 'Set MSH.3',
        enabled: true,
        messageSegment: "tmp['MSH']['MSH.3']",
        mapping: "'MySystem'",
        defaultValue: "'DEFAULT'",
        replacements: [{ pattern: "' '", replacement: "'_'" }],
      });

      expect(step.getSequenceNumber()).toBe(1);
      expect(step.getName()).toBe('Set MSH.3');
      expect(step.getMessageSegment()).toBe("tmp['MSH']['MSH.3']");
      expect(step.getMapping()).toBe("'MySystem'");
      expect(step.getDefaultValue()).toBe("'DEFAULT'");
      expect(step.getReplacements()).toHaveLength(1);
    });
  });

  describe('PLUGIN_POINT', () => {
    it('should have correct plugin point', () => {
      expect(MessageBuilderStep.PLUGIN_POINT).toBe('Message Builder');
      expect(MESSAGE_BUILDER_STEP_PLUGIN_POINT).toBe('Message Builder');
    });
  });

  describe('setters', () => {
    it('should update all properties', () => {
      const step = new MessageBuilderStep();

      step.setSequenceNumber(5);
      step.setName('Test');
      step.setEnabled(false);
      step.setMessageSegment("tmp['PID']['PID.3']");
      step.setMapping('msg.patientId');
      step.setDefaultValue("''");
      step.setReplacements([{ pattern: '/x/', replacement: "'y'" }]);

      expect(step.getSequenceNumber()).toBe(5);
      expect(step.getName()).toBe('Test');
      expect(step.isEnabled()).toBe(false);
      expect(step.getMessageSegment()).toBe("tmp['PID']['PID.3']");
      expect(step.getMapping()).toBe('msg.patientId');
      expect(step.getDefaultValue()).toBe("''");
      expect(step.getReplacements()).toHaveLength(1);
    });
  });

  describe('clone', () => {
    it('should create a deep copy', () => {
      const original = new MessageBuilderStep({
        sequenceNumber: 1,
        name: 'Original',
        messageSegment: "tmp['MSH']",
        mapping: "msg['MSH']",
        replacements: [{ pattern: '/a/', replacement: "'b'" }],
      });

      const cloned = original.clone();

      expect(cloned.getMessageSegment()).toBe("tmp['MSH']");
      expect(cloned.getReplacements()).toHaveLength(1);

      // Verify it's a separate object
      cloned.setMessageSegment("tmp['PID']");
      cloned.getReplacements()[0]!.pattern = '/x/';

      expect(original.getMessageSegment()).toBe("tmp['MSH']");
      expect(original.getReplacements()[0]!.pattern).toBe('/a/');
    });
  });

  describe('getResponseVariables', () => {
    it('should always return empty array', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['MSH']",
        mapping: '$r("test")',
      });

      // Message Builder doesn't set response variables directly
      expect(step.getResponseVariables()).toEqual([]);
    });
  });

  describe('getScript', () => {
    it('should generate assignment script', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['MSH']['MSH.3']",
        mapping: "'MIRTH'",
      });

      const script = step.getScript();

      expect(script).toBe("tmp['MSH']['MSH.3'] = validate('MIRTH', '', new Array());");
    });

    it('should include default value', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['MSH']['MSH.3']",
        mapping: 'msg.value',
        defaultValue: "'DEFAULT'",
      });

      const script = step.getScript();
      expect(script).toContain("'DEFAULT'");
    });

    it('should handle empty mapping', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['MSH']['MSH.3']",
        mapping: '',
      });

      const script = step.getScript();
      expect(script).toContain("validate('', ''");
    });

    it('should include replacements', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['field']",
        mapping: 'msg.data',
        replacements: [
          { pattern: '/\\s+/', replacement: "' '" },
          { pattern: '/[^a-z]/i', replacement: "''" },
        ],
      });

      const script = step.getScript();
      expect(script).toContain('new Array(/\\s+/');
      expect(script).toContain("new Array(/[^a-z]/i, '')");
    });
  });

  describe('iterator scripts', () => {
    it('should return null for pre-script', () => {
      const step = new MessageBuilderStep();
      expect(step.getPreScript()).toBeNull();
    });

    it('should return null for post-script', () => {
      const step = new MessageBuilderStep();
      expect(step.getPostScript()).toBeNull();
    });

    it('should generate iteration script with segment creation', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['OBX'][i]['OBX.5']",
        mapping: "msg['OBX'][i]['OBX.5']",
      });

      const script = step.getIterationScript(false, [{ indexVariable: 'i' }]);

      // Should include XML type check
      expect(script).toContain("typeof(tmp) == 'xml'");
      // Should include the assignment
      expect(script).toContain("tmp['OBX'][i]['OBX.5'] = validate");
    });

    it('should handle simple expression without iteration logic', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['MSH']",
        mapping: "'value'",
      });

      const script = step.getIterationScript(false, []);

      // Simple expression should just have the assignment
      expect(script).toContain("tmp['MSH'] = validate");
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const step = new MessageBuilderStep({
        sequenceNumber: 1,
        name: 'Test',
        messageSegment: "tmp['field']",
        mapping: 'msg.data',
        defaultValue: "''",
        replacements: [{ pattern: '/a/', replacement: "'b'" }],
      });

      const json = step.toJSON();

      expect(json.sequenceNumber).toBe(1);
      expect(json.name).toBe('Test');
      expect(json.messageSegment).toBe("tmp['field']");
      expect(json.mapping).toBe('msg.data');
      expect(json.type).toBe('Message Builder');
    });
  });

  describe('fromXML', () => {
    it('should parse valid data', () => {
      const step = MessageBuilderStep.fromXML({
        sequenceNumber: 2,
        name: 'Imported',
        messageSegment: "tmp['PID']",
        mapping: 'msg.PID',
        defaultValue: "''",
        replacements: [{ pattern: '/x/', replacement: "'y'" }],
      });

      expect(step.getMessageSegment()).toBe("tmp['PID']");
      expect(step.getMapping()).toBe('msg.PID');
      expect(step.getReplacements()).toHaveLength(1);
    });

    it('should handle missing fields', () => {
      const step = MessageBuilderStep.fromXML({});

      expect(step.getMessageSegment()).toBe('');
      expect(step.getMapping()).toBe('');
      expect(step.getDefaultValue()).toBe('');
      expect(step.getReplacements()).toEqual([]);
    });

    it('should filter invalid replacements', () => {
      const step = MessageBuilderStep.fromXML({
        replacements: [
          { pattern: '/a/', replacement: "'b'" },
          { invalid: 'data' },
          null,
          { pattern: '/c/' }, // missing replacement
        ],
      });

      expect(step.getReplacements()).toHaveLength(1);
    });
  });

  describe('factory function', () => {
    it('should create step with createMessageBuilderStep', () => {
      const step = createMessageBuilderStep('Set Field', "tmp['MSH']['MSH.3']", "'SYSTEM'");

      expect(step.getName()).toBe('Set Field');
      expect(step.getMessageSegment()).toBe("tmp['MSH']['MSH.3']");
      expect(step.getMapping()).toBe("'SYSTEM'");
      expect(step.isEnabled()).toBe(true);
    });

    it('should use default mapping', () => {
      const step = createMessageBuilderStep('Simple', "tmp['field']");

      expect(step.getMapping()).toBe('');
    });
  });

  describe('type guards', () => {
    it('should identify MessageBuilderStep instances', () => {
      const step = new MessageBuilderStep();
      expect(isMessageBuilderStep(step)).toBe(true);
    });

    it('should reject non-MessageBuilderStep objects', () => {
      expect(isMessageBuilderStep({})).toBe(false);
      expect(isMessageBuilderStep(null)).toBe(false);
    });

    it('should check type string', () => {
      expect(isMessageBuilderStepType({ type: 'Message Builder' })).toBe(true);
      expect(isMessageBuilderStepType({ type: 'Mapper' })).toBe(false);
    });
  });

  describe('getPurgedProperties', () => {
    it('should return analytics properties', () => {
      const step = new MessageBuilderStep({
        sequenceNumber: 1,
        enabled: false,
        replacements: [
          { pattern: '/a/', replacement: "'b'" },
          { pattern: '/c/', replacement: "'d'" },
        ],
      });

      const purged = step.getPurgedProperties();

      expect(purged.sequenceNumber).toBe(1);
      expect(purged.enabled).toBe(false);
      expect(purged.replacementsCount).toBe(2);
    });
  });

  describe('complex segment expressions', () => {
    it('should parse bracket notation', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['OBX'][0]['OBX.5']['OBX.5.1']",
        mapping: "'value'",
      });

      const script = step.getIterationScript(false, []);
      // Should contain segment creation checks
      expect(script).toContain('validate');
    });

    it('should handle nested index variables', () => {
      const step = new MessageBuilderStep({
        messageSegment: "tmp['OBR'][i]['OBX'][j]['OBX.5']",
        mapping: "msg['OBR'][i]['OBX'][j]['OBX.5']",
      });

      const script = step.getIterationScript(false, [
        { indexVariable: 'i' },
        { indexVariable: 'j' },
      ]);

      expect(script).toContain("typeof(tmp) == 'xml'");
      expect(script).toContain('validate');
    });
  });
});
