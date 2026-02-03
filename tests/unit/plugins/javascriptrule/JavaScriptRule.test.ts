import {
  JavaScriptRule,
  createJavaScriptRule,
  isJavaScriptRule,
  isJavaScriptRuleType,
  JAVASCRIPT_RULE_PLUGIN_POINT,
} from '../../../../src/plugins/javascriptrule/JavaScriptRule';

describe('JavaScriptRule', () => {
  describe('constructor', () => {
    it('should create rule with default values', () => {
      const rule = new JavaScriptRule();

      expect(rule.getSequenceNumber()).toBe(0);
      expect(rule.getName()).toBe('');
      expect(rule.getScript()).toBe('');
      expect(rule.isEnabled()).toBe(true);
      expect(rule.getOperator()).toBe('AND');
      expect(rule.getType()).toBe('JavaScript');
    });

    it('should create rule with provided values', () => {
      const rule = new JavaScriptRule({
        sequenceNumber: 1,
        name: 'Test Rule',
        script: 'return true;',
        enabled: false,
        operator: 'OR',
      });

      expect(rule.getSequenceNumber()).toBe(1);
      expect(rule.getName()).toBe('Test Rule');
      expect(rule.getScript()).toBe('return true;');
      expect(rule.isEnabled()).toBe(false);
      expect(rule.getOperator()).toBe('OR');
    });
  });

  describe('PLUGIN_POINT', () => {
    it('should have correct plugin point', () => {
      expect(JavaScriptRule.PLUGIN_POINT).toBe('JavaScript');
      expect(JAVASCRIPT_RULE_PLUGIN_POINT).toBe('JavaScript');
    });
  });

  describe('setters', () => {
    it('should update sequence number', () => {
      const rule = new JavaScriptRule();
      rule.setSequenceNumber(5);
      expect(rule.getSequenceNumber()).toBe(5);
    });

    it('should update name', () => {
      const rule = new JavaScriptRule();
      rule.setName('My Rule');
      expect(rule.getName()).toBe('My Rule');
    });

    it('should update script', () => {
      const rule = new JavaScriptRule();
      rule.setScript('return msg.MSH !== undefined;');
      expect(rule.getScript()).toBe('return msg.MSH !== undefined;');
    });

    it('should update enabled', () => {
      const rule = new JavaScriptRule();
      rule.setEnabled(false);
      expect(rule.isEnabled()).toBe(false);
    });

    it('should update operator', () => {
      const rule = new JavaScriptRule();
      rule.setOperator('NONE');
      expect(rule.getOperator()).toBe('NONE');
    });
  });

  describe('clone', () => {
    it('should create a deep copy', () => {
      const original = new JavaScriptRule({
        sequenceNumber: 1,
        name: 'Original',
        script: 'return true;',
        enabled: true,
        operator: 'AND',
      });

      const cloned = original.clone();

      expect(cloned.getSequenceNumber()).toBe(1);
      expect(cloned.getName()).toBe('Original');
      expect(cloned.getScript()).toBe('return true;');
      expect(cloned.isEnabled()).toBe(true);
      expect(cloned.getOperator()).toBe('AND');

      // Verify it's a separate object
      cloned.setName('Cloned');
      expect(original.getName()).toBe('Original');
      expect(cloned.getName()).toBe('Cloned');
    });
  });

  describe('getResponseVariables', () => {
    it('should return empty array for script without response variables', () => {
      const rule = new JavaScriptRule({
        script: 'return msg.MSH !== undefined;',
      });

      expect(rule.getResponseVariables()).toEqual([]);
    });

    it('should detect $r() calls', () => {
      const rule = new JavaScriptRule({
        script: `
          $r('result', 'success');
          $r('count', 42);
        `,
      });

      expect(rule.getResponseVariables()).toContain('result');
      expect(rule.getResponseVariables()).toContain('count');
    });

    it('should detect responseMap.put() calls', () => {
      const rule = new JavaScriptRule({
        script: `
          responseMap.put('status', 'OK');
          responseMap.put("message", "Processed");
        `,
      });

      expect(rule.getResponseVariables()).toContain('status');
      expect(rule.getResponseVariables()).toContain('message');
    });

    it('should not duplicate response variables', () => {
      const rule = new JavaScriptRule({
        script: `
          $r('key', 'value1');
          $r('key', 'value2');
        `,
      });

      const vars = rule.getResponseVariables();
      expect(vars.filter((v) => v === 'key').length).toBe(1);
    });
  });

  describe('getPurgedProperties', () => {
    it('should return analytics properties', () => {
      const rule = new JavaScriptRule({
        sequenceNumber: 1,
        script: 'line1\nline2\nline3',
        enabled: true,
        operator: 'OR',
      });

      const purged = rule.getPurgedProperties();

      expect(purged.sequenceNumber).toBe(1);
      expect(purged.enabled).toBe(true);
      expect(purged.operator).toBe('OR');
      expect(purged.scriptLines).toBe(3);
    });

    it('should handle empty script', () => {
      const rule = new JavaScriptRule();
      const purged = rule.getPurgedProperties();
      expect(purged.scriptLines).toBe(0);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const rule = new JavaScriptRule({
        sequenceNumber: 1,
        name: 'Test',
        script: 'return true;',
        enabled: true,
        operator: 'AND',
      });

      const json = rule.toJSON();

      expect(json.sequenceNumber).toBe(1);
      expect(json.name).toBe('Test');
      expect(json.script).toBe('return true;');
      expect(json.enabled).toBe(true);
      expect(json.operator).toBe('AND');
      expect(json.type).toBe('JavaScript');
    });
  });

  describe('fromXML', () => {
    it('should parse valid data', () => {
      const rule = JavaScriptRule.fromXML({
        sequenceNumber: 2,
        name: 'Imported Rule',
        script: 'return false;',
        enabled: false,
        operator: 'OR',
      });

      expect(rule.getSequenceNumber()).toBe(2);
      expect(rule.getName()).toBe('Imported Rule');
      expect(rule.getScript()).toBe('return false;');
      expect(rule.isEnabled()).toBe(false);
      expect(rule.getOperator()).toBe('OR');
    });

    it('should handle missing fields', () => {
      const rule = JavaScriptRule.fromXML({});

      expect(rule.getSequenceNumber()).toBe(0);
      expect(rule.getName()).toBe('');
      expect(rule.getScript()).toBe('');
      expect(rule.isEnabled()).toBe(true);
      expect(rule.getOperator()).toBe('AND');
    });

    it('should handle invalid operator', () => {
      const rule = JavaScriptRule.fromXML({
        operator: 'INVALID',
      });

      expect(rule.getOperator()).toBe('AND');
    });
  });

  describe('factory function', () => {
    it('should create rule with createJavaScriptRule', () => {
      const rule = createJavaScriptRule('My Rule', 'return true;', 'OR');

      expect(rule.getName()).toBe('My Rule');
      expect(rule.getScript()).toBe('return true;');
      expect(rule.getOperator()).toBe('OR');
      expect(rule.isEnabled()).toBe(true);
    });

    it('should use default values', () => {
      const rule = createJavaScriptRule('Simple Rule');

      expect(rule.getName()).toBe('Simple Rule');
      expect(rule.getScript()).toBe('');
      expect(rule.getOperator()).toBe('AND');
    });
  });

  describe('type guards', () => {
    it('should identify JavaScriptRule instances', () => {
      const rule = new JavaScriptRule();
      expect(isJavaScriptRule(rule)).toBe(true);
    });

    it('should reject non-JavaScriptRule objects', () => {
      expect(isJavaScriptRule({})).toBe(false);
      expect(isJavaScriptRule(null)).toBe(false);
      expect(isJavaScriptRule(undefined)).toBe(false);
      expect(isJavaScriptRule('string')).toBe(false);
    });

    it('should check type string', () => {
      expect(isJavaScriptRuleType({ type: 'JavaScript' })).toBe(true);
      expect(isJavaScriptRuleType({ type: 'Rule Builder' })).toBe(false);
      expect(isJavaScriptRuleType({})).toBe(false);
    });
  });
});
