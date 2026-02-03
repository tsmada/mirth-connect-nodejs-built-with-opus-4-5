import {
  JavaScriptStep,
  createJavaScriptStep,
  isJavaScriptStep,
  isJavaScriptStepType,
  JAVASCRIPT_STEP_PLUGIN_POINT,
} from '../../../../src/plugins/javascriptstep/JavaScriptStep';

describe('JavaScriptStep', () => {
  describe('constructor', () => {
    it('should create step with default values', () => {
      const step = new JavaScriptStep();

      expect(step.getSequenceNumber()).toBe(0);
      expect(step.getName()).toBe('');
      expect(step.getScript()).toBe('');
      expect(step.isEnabled()).toBe(true);
      expect(step.getType()).toBe('JavaScript');
    });

    it('should create step with provided values', () => {
      const step = new JavaScriptStep({
        sequenceNumber: 1,
        name: 'Test Step',
        script: 'tmp["MSH"]["MSH.3"] = "SYSTEM";',
        enabled: false,
      });

      expect(step.getSequenceNumber()).toBe(1);
      expect(step.getName()).toBe('Test Step');
      expect(step.getScript()).toBe('tmp["MSH"]["MSH.3"] = "SYSTEM";');
      expect(step.isEnabled()).toBe(false);
    });
  });

  describe('PLUGIN_POINT', () => {
    it('should have correct plugin point', () => {
      expect(JavaScriptStep.PLUGIN_POINT).toBe('JavaScript');
      expect(JAVASCRIPT_STEP_PLUGIN_POINT).toBe('JavaScript');
    });
  });

  describe('setters', () => {
    it('should update sequence number', () => {
      const step = new JavaScriptStep();
      step.setSequenceNumber(5);
      expect(step.getSequenceNumber()).toBe(5);
    });

    it('should update name', () => {
      const step = new JavaScriptStep();
      step.setName('My Step');
      expect(step.getName()).toBe('My Step');
    });

    it('should update script', () => {
      const step = new JavaScriptStep();
      step.setScript('$c("patientId", msg.PID.getField(3));');
      expect(step.getScript()).toBe('$c("patientId", msg.PID.getField(3));');
    });

    it('should update enabled', () => {
      const step = new JavaScriptStep();
      step.setEnabled(false);
      expect(step.isEnabled()).toBe(false);
    });
  });

  describe('clone', () => {
    it('should create a deep copy', () => {
      const original = new JavaScriptStep({
        sequenceNumber: 1,
        name: 'Original',
        script: 'channelMap.put("key", "value");',
        enabled: true,
      });

      const cloned = original.clone();

      expect(cloned.getSequenceNumber()).toBe(1);
      expect(cloned.getName()).toBe('Original');
      expect(cloned.getScript()).toBe('channelMap.put("key", "value");');
      expect(cloned.isEnabled()).toBe(true);

      // Verify it's a separate object
      cloned.setName('Cloned');
      expect(original.getName()).toBe('Original');
      expect(cloned.getName()).toBe('Cloned');
    });
  });

  describe('getResponseVariables', () => {
    it('should return empty array for step without response variables', () => {
      const step = new JavaScriptStep({
        script: 'channelMap.put("key", "value");',
      });

      expect(step.getResponseVariables()).toEqual([]);
    });

    it('should detect $r() calls', () => {
      const step = new JavaScriptStep({
        script: `
          $r('result', 'success');
          $r('processedAt', new Date().toString());
        `,
      });

      expect(step.getResponseVariables()).toContain('result');
      expect(step.getResponseVariables()).toContain('processedAt');
    });

    it('should detect responseMap.put() calls', () => {
      const step = new JavaScriptStep({
        script: `
          responseMap.put('status', 'OK');
          responseMap.put("destination1", "ACK");
        `,
      });

      expect(step.getResponseVariables()).toContain('status');
      expect(step.getResponseVariables()).toContain('destination1');
    });

    it('should not duplicate response variables', () => {
      const step = new JavaScriptStep({
        script: `
          $r('key', 'value1');
          responseMap.put('key', 'value2');
        `,
      });

      const vars = step.getResponseVariables();
      expect(vars.filter((v) => v === 'key').length).toBe(1);
    });
  });

  describe('getPurgedProperties', () => {
    it('should return analytics properties', () => {
      const step = new JavaScriptStep({
        sequenceNumber: 3,
        script: 'line1\nline2\nline3\nline4',
        enabled: false,
      });

      const purged = step.getPurgedProperties();

      expect(purged.sequenceNumber).toBe(3);
      expect(purged.enabled).toBe(false);
      expect(purged.scriptLines).toBe(4);
    });

    it('should handle empty script', () => {
      const step = new JavaScriptStep();
      const purged = step.getPurgedProperties();
      expect(purged.scriptLines).toBe(0);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const step = new JavaScriptStep({
        sequenceNumber: 1,
        name: 'Test',
        script: 'var x = 1;',
        enabled: true,
      });

      const json = step.toJSON();

      expect(json.sequenceNumber).toBe(1);
      expect(json.name).toBe('Test');
      expect(json.script).toBe('var x = 1;');
      expect(json.enabled).toBe(true);
      expect(json.type).toBe('JavaScript');
    });
  });

  describe('fromXML', () => {
    it('should parse valid data', () => {
      const step = JavaScriptStep.fromXML({
        sequenceNumber: 2,
        name: 'Imported Step',
        script: 'logger.info("test");',
        enabled: false,
      });

      expect(step.getSequenceNumber()).toBe(2);
      expect(step.getName()).toBe('Imported Step');
      expect(step.getScript()).toBe('logger.info("test");');
      expect(step.isEnabled()).toBe(false);
    });

    it('should handle missing fields', () => {
      const step = JavaScriptStep.fromXML({});

      expect(step.getSequenceNumber()).toBe(0);
      expect(step.getName()).toBe('');
      expect(step.getScript()).toBe('');
      expect(step.isEnabled()).toBe(true);
    });
  });

  describe('factory function', () => {
    it('should create step with createJavaScriptStep', () => {
      const step = createJavaScriptStep('My Step', 'var x = msg.PID;');

      expect(step.getName()).toBe('My Step');
      expect(step.getScript()).toBe('var x = msg.PID;');
      expect(step.isEnabled()).toBe(true);
    });

    it('should use default script', () => {
      const step = createJavaScriptStep('Simple Step');

      expect(step.getName()).toBe('Simple Step');
      expect(step.getScript()).toBe('');
    });
  });

  describe('type guards', () => {
    it('should identify JavaScriptStep instances', () => {
      const step = new JavaScriptStep();
      expect(isJavaScriptStep(step)).toBe(true);
    });

    it('should reject non-JavaScriptStep objects', () => {
      expect(isJavaScriptStep({})).toBe(false);
      expect(isJavaScriptStep(null)).toBe(false);
      expect(isJavaScriptStep(undefined)).toBe(false);
      expect(isJavaScriptStep('string')).toBe(false);
    });

    it('should check type string', () => {
      expect(isJavaScriptStepType({ type: 'JavaScript' })).toBe(true);
      expect(isJavaScriptStepType({ type: 'Mapper' })).toBe(false);
      expect(isJavaScriptStepType({})).toBe(false);
    });
  });
});
