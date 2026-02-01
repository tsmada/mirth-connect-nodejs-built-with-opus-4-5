import { Filter } from '../../../src/model/Filter';
import { Rule } from '../../../src/model/Rule';
import { Transformer } from '../../../src/model/Transformer';
import { Step } from '../../../src/model/Step';

describe('Filter', () => {
  describe('constructor', () => {
    it('should create an empty filter', () => {
      const filter = new Filter();
      expect(filter.hasRules()).toBe(false);
      expect(filter.getRuleCount()).toBe(0);
    });

    it('should create a filter with rules', () => {
      const filter = new Filter({
        rules: [
          { name: 'Rule 1', script: 'return true;' },
          { name: 'Rule 2', script: 'return false;' },
        ],
      });

      expect(filter.hasRules()).toBe(true);
      expect(filter.getRuleCount()).toBe(2);
    });
  });

  describe('generateScript', () => {
    it('should return accept all for empty filter', () => {
      const filter = new Filter();
      expect(filter.generateScript()).toBe('return true;');
    });

    it('should combine rules with AND operator', () => {
      const filter = new Filter();
      filter.addRule(new Rule({ script: 'condition1', operator: 'NONE' }));
      filter.addRule(new Rule({ script: 'condition2', operator: 'AND' }));

      const script = filter.generateScript();
      expect(script).toContain('condition1');
      expect(script).toContain('&&');
      expect(script).toContain('condition2');
    });

    it('should combine rules with OR operator', () => {
      const filter = new Filter();
      filter.addRule(new Rule({ script: 'condition1', operator: 'NONE' }));
      filter.addRule(new Rule({ script: 'condition2', operator: 'OR' }));

      const script = filter.generateScript();
      expect(script).toContain('||');
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const filter = new Filter({
        rules: [{ name: 'Test', script: 'return true;' }],
      });

      const json = filter.toJSON();
      expect(json.rules).toHaveLength(1);
      expect(json.rules?.[0]?.name).toBe('Test');
    });
  });
});

describe('Rule', () => {
  describe('constructor', () => {
    it('should create a rule with defaults', () => {
      const rule = new Rule();

      expect(rule.getSequenceNumber()).toBe(0);
      expect(rule.getName()).toBe('');
      expect(rule.getType()).toBe('JavaScript');
      expect(rule.getScript()).toBe('return true;');
      expect(rule.isEnabled()).toBe(true);
      expect(rule.getOperator()).toBe('AND');
    });

    it('should create a rule with custom values', () => {
      const rule = new Rule({
        sequenceNumber: 1,
        name: 'Accept ADT',
        type: 'Rule Builder',
        script: "msg['MSH']['MSH.9'].toString().startsWith('ADT')",
        enabled: true,
        operator: 'OR',
      });

      expect(rule.getName()).toBe('Accept ADT');
      expect(rule.getType()).toBe('Rule Builder');
      expect(rule.getOperator()).toBe('OR');
    });
  });
});

describe('Transformer', () => {
  describe('constructor', () => {
    it('should create an empty transformer', () => {
      const transformer = new Transformer();

      expect(transformer.hasSteps()).toBe(false);
      expect(transformer.getInboundDataType()).toBe('HL7V2');
      expect(transformer.getOutboundDataType()).toBe('HL7V2');
    });

    it('should create a transformer with steps', () => {
      const transformer = new Transformer({
        steps: [{ name: 'Step 1', script: 'msg.foo = "bar"' }],
        inboundDataType: 'XML',
        outboundDataType: 'JSON',
      });

      expect(transformer.hasSteps()).toBe(true);
      expect(transformer.getStepCount()).toBe(1);
      expect(transformer.getInboundDataType()).toBe('XML');
      expect(transformer.getOutboundDataType()).toBe('JSON');
    });
  });

  describe('generateScript', () => {
    it('should return empty string for no steps', () => {
      const transformer = new Transformer();
      expect(transformer.generateScript()).toBe('');
    });

    it('should combine enabled step scripts', () => {
      const transformer = new Transformer();
      transformer.addStep(new Step({ script: 'step1();', enabled: true }));
      transformer.addStep(new Step({ script: 'step2();', enabled: false }));
      transformer.addStep(new Step({ script: 'step3();', enabled: true }));

      const script = transformer.generateScript();
      expect(script).toContain('step1();');
      expect(script).not.toContain('step2();');
      expect(script).toContain('step3();');
    });
  });
});

describe('Step', () => {
  describe('constructor', () => {
    it('should create a step with defaults', () => {
      const step = new Step();

      expect(step.getSequenceNumber()).toBe(0);
      expect(step.getName()).toBe('');
      expect(step.getType()).toBe('JavaScript');
      expect(step.getScript()).toBe('');
      expect(step.isEnabled()).toBe(true);
    });

    it('should create a step with custom values', () => {
      const step = new Step({
        sequenceNumber: 1,
        name: 'Set Patient Name',
        type: 'Mapper',
        script: "$c('patientName', msg['PID']['PID.5'].toString())",
        enabled: true,
        data: { mapping: 'PID.5' },
      });

      expect(step.getName()).toBe('Set Patient Name');
      expect(step.getType()).toBe('Mapper');
      expect(step.getData()).toEqual({ mapping: 'PID.5' });
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const step = new Step({
        name: 'Test Step',
        script: 'test();',
      });

      const json = step.toJSON();
      expect(json.name).toBe('Test Step');
      expect(json.script).toBe('test();');
    });
  });
});
