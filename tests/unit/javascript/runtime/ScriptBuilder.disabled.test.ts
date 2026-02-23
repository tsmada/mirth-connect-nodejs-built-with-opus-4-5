import {
  ScriptBuilder,
  FilterRule,
  TransformerStep,
  SerializationType,
} from '../../../../src/javascript/runtime/ScriptBuilder';

/**
 * Tests that disabled filter rules and transformer steps are correctly excluded
 * from generated scripts. The key invariant: a script generated with some items
 * disabled should be identical to a script generated with those items omitted entirely.
 *
 * This verifies ScriptBuilder.appendFilterScript() and appendTransformerScript()
 * correctly filter on the `enabled` flag before generating code.
 */
describe('ScriptBuilder — disabled rules/steps', () => {
  let builder: ScriptBuilder;

  beforeEach(() => {
    builder = new ScriptBuilder({ transpileE4X: false });
  });

  // Helper: generate a filter/transformer script with given rules/steps
  function generate(
    rules: FilterRule[],
    steps: TransformerStep[]
  ): string {
    return builder.generateFilterTransformerScript(
      rules,
      steps,
      SerializationType.RAW,
      SerializationType.RAW,
      false
    );
  }

  function makeRule(name: string, script: string, enabled: boolean, operator: 'AND' | 'OR' = 'AND'): FilterRule {
    return { name, script, operator, enabled };
  }

  function makeStep(name: string, script: string, enabled: boolean): TransformerStep {
    return { name, script, enabled };
  }

  // ---------------------------------------------------------------------------
  // Filter rules
  // ---------------------------------------------------------------------------
  describe('disabled filter rules', () => {
    it('3 rules with middle one disabled produces same script as 2-rule filter (rules 1 and 3)', () => {
      const withDisabled = generate(
        [
          makeRule('Rule A', 'return msg.type === "ADT";', true),
          makeRule('Rule B', 'return msg.version > 2;', false),  // disabled
          makeRule('Rule C', 'return msg.active === true;', true),
        ],
        []
      );

      const withoutMiddle = generate(
        [
          makeRule('Rule A', 'return msg.type === "ADT";', true),
          makeRule('Rule C', 'return msg.active === true;', true),
        ],
        []
      );

      expect(withDisabled).toBe(withoutMiddle);
    });

    it('all 3 rules disabled produces same script as empty filter (doFilter returns true)', () => {
      const allDisabled = generate(
        [
          makeRule('Rule A', 'return msg.type === "ADT";', false),
          makeRule('Rule B', 'return msg.version > 2;', false),
          makeRule('Rule C', 'return msg.active === true;', false),
        ],
        []
      );

      const noRules = generate([], []);

      expect(allDisabled).toBe(noRules);
    });

    it('single rule disabled produces same script as empty filter', () => {
      const singleDisabled = generate(
        [makeRule('Only Rule', 'return false;', false)],
        []
      );

      const noRules = generate([], []);

      expect(singleDisabled).toBe(noRules);
    });

    it('disabled rules with mixed AND/OR operators preserve correct operators for remaining rules', () => {
      // Rules: A (AND), B (OR, disabled), C (AND), D (OR)
      // Result should be equivalent to: A (AND), C (AND), D (OR)
      const withDisabled = generate(
        [
          makeRule('Rule A', 'return true;', true, 'AND'),
          makeRule('Rule B', 'return false;', false, 'OR'),    // disabled
          makeRule('Rule C', 'return true;', true, 'AND'),
          makeRule('Rule D', 'return true;', true, 'OR'),
        ],
        []
      );

      const withoutDisabled = generate(
        [
          makeRule('Rule A', 'return true;', true, 'AND'),
          makeRule('Rule C', 'return true;', true, 'AND'),
          makeRule('Rule D', 'return true;', true, 'OR'),
        ],
        []
      );

      expect(withDisabled).toBe(withoutDisabled);
    });

    it('first rule disabled leaves remaining rules correctly numbered', () => {
      const firstDisabled = generate(
        [
          makeRule('Rule A', 'return false;', false),           // disabled
          makeRule('Rule B', 'return msg.version > 2;', true),
          makeRule('Rule C', 'return msg.active === true;', true),
        ],
        []
      );

      const withoutFirst = generate(
        [
          makeRule('Rule B', 'return msg.version > 2;', true),
          makeRule('Rule C', 'return msg.active === true;', true),
        ],
        []
      );

      expect(firstDisabled).toBe(withoutFirst);
    });

    it('empty filter generates doFilter that returns true', () => {
      const script = generate([], []);
      expect(script).toContain('function doFilter() { phase[0] = "filter"; return true; }');
    });
  });

  // ---------------------------------------------------------------------------
  // Transformer steps
  // ---------------------------------------------------------------------------
  describe('disabled transformer steps', () => {
    it('3 steps with middle one disabled produces same script as 2-step transformer', () => {
      const withDisabled = generate(
        [],
        [
          makeStep('Step 1', 'msg.field1 = "a";', true),
          makeStep('Step 2', 'msg.field2 = "b";', false),  // disabled
          makeStep('Step 3', 'msg.field3 = "c";', true),
        ]
      );

      const withoutMiddle = generate(
        [],
        [
          makeStep('Step 1', 'msg.field1 = "a";', true),
          makeStep('Step 3', 'msg.field3 = "c";', true),
        ]
      );

      expect(withDisabled).toBe(withoutMiddle);
    });

    it('all 3 steps disabled produces same script as empty transformer (with auto-serialization)', () => {
      const allDisabled = generate(
        [],
        [
          makeStep('Step 1', 'msg.field1 = "a";', false),
          makeStep('Step 2', 'msg.field2 = "b";', false),
          makeStep('Step 3', 'msg.field3 = "c";', false),
        ]
      );

      const noSteps = generate([], []);

      expect(allDisabled).toBe(noSteps);
    });

    it('empty transformer still has auto-serialization in doTransform', () => {
      const script = generate([], []);
      expect(script).toContain('function doTransform()');
      expect(script).toContain('phase[0] = "transform"');
      // Auto-serialization should still be present
      expect(script).toContain('toXMLString');
    });

    it('single step disabled produces same script as empty transformer', () => {
      const singleDisabled = generate(
        [],
        [makeStep('Only Step', 'msg.data = "test";', false)]
      );

      const noSteps = generate([], []);

      expect(singleDisabled).toBe(noSteps);
    });

    it('first step disabled leaves remaining steps correctly numbered', () => {
      const firstDisabled = generate(
        [],
        [
          makeStep('Step 1', 'msg.a = 1;', false),  // disabled
          makeStep('Step 2', 'msg.b = 2;', true),
          makeStep('Step 3', 'msg.c = 3;', true),
        ]
      );

      const withoutFirst = generate(
        [],
        [
          makeStep('Step 2', 'msg.b = 2;', true),
          makeStep('Step 3', 'msg.c = 3;', true),
        ]
      );

      expect(firstDisabled).toBe(withoutFirst);
    });
  });

  // ---------------------------------------------------------------------------
  // Combined filter + transformer
  // ---------------------------------------------------------------------------
  describe('mixed disabled rules and steps', () => {
    it('disabled rule + disabled step produces same script as reduced set', () => {
      const withDisabled = generate(
        [
          makeRule('Rule A', 'return true;', true),
          makeRule('Rule B', 'return false;', false),  // disabled
        ],
        [
          makeStep('Step 1', 'msg.a = 1;', true),
          makeStep('Step 2', 'msg.b = 2;', false),    // disabled
          makeStep('Step 3', 'msg.c = 3;', true),
        ]
      );

      const reduced = generate(
        [makeRule('Rule A', 'return true;', true)],
        [
          makeStep('Step 1', 'msg.a = 1;', true),
          makeStep('Step 3', 'msg.c = 3;', true),
        ]
      );

      expect(withDisabled).toBe(reduced);
    });

    it('all rules disabled + all steps disabled equals fully empty script', () => {
      const allDisabled = generate(
        [
          makeRule('Rule A', 'return true;', false),
          makeRule('Rule B', 'return false;', false),
        ],
        [
          makeStep('Step 1', 'msg.a = 1;', false),
          makeStep('Step 2', 'msg.b = 2;', false),
        ]
      );

      const empty = generate([], []);

      expect(allDisabled).toBe(empty);
    });
  });
});
