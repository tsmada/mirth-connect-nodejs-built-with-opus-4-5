import {
  MapperStep,
  MapperScope,
  MAPPER_STEP_PLUGIN_POINT,
  SCOPE_MAP_NAMES,
  SCOPE_LABELS,
  createMapperStep,
  isMapperStep,
  isMapperStepType,
  getScopeFromString,
  getScopeLabel,
} from '../../../../src/plugins/mapper/MapperStep';

describe('MapperStep', () => {
  describe('constructor', () => {
    it('should create step with default values', () => {
      const step = new MapperStep();

      expect(step.getSequenceNumber()).toBe(0);
      expect(step.getName()).toBe('');
      expect(step.isEnabled()).toBe(true);
      expect(step.getVariable()).toBe('');
      expect(step.getMapping()).toBe('');
      expect(step.getDefaultValue()).toBe('');
      expect(step.getReplacements()).toEqual([]);
      expect(step.getScope()).toBe(MapperScope.CHANNEL);
      expect(step.getType()).toBe('Mapper');
    });

    it('should create step with provided values', () => {
      const step = new MapperStep({
        sequenceNumber: 1,
        name: 'Patient ID',
        enabled: true,
        variable: 'patientId',
        mapping: "msg['PID']['PID.3']['PID.3.1'].toString()",
        defaultValue: "'UNKNOWN'",
        replacements: [{ pattern: "'-'", replacement: "''" }],
        scope: MapperScope.GLOBAL,
      });

      expect(step.getSequenceNumber()).toBe(1);
      expect(step.getName()).toBe('Patient ID');
      expect(step.getVariable()).toBe('patientId');
      expect(step.getMapping()).toBe("msg['PID']['PID.3']['PID.3.1'].toString()");
      expect(step.getDefaultValue()).toBe("'UNKNOWN'");
      expect(step.getReplacements()).toHaveLength(1);
      expect(step.getScope()).toBe(MapperScope.GLOBAL);
    });
  });

  describe('PLUGIN_POINT', () => {
    it('should have correct plugin point', () => {
      expect(MapperStep.PLUGIN_POINT).toBe('Mapper');
      expect(MAPPER_STEP_PLUGIN_POINT).toBe('Mapper');
    });
  });

  describe('scopes', () => {
    it('should have correct map names', () => {
      expect(SCOPE_MAP_NAMES[MapperScope.CONNECTOR]).toBe('connectorMap');
      expect(SCOPE_MAP_NAMES[MapperScope.CHANNEL]).toBe('channelMap');
      expect(SCOPE_MAP_NAMES[MapperScope.GLOBAL_CHANNEL]).toBe('globalChannelMap');
      expect(SCOPE_MAP_NAMES[MapperScope.GLOBAL]).toBe('globalMap');
      expect(SCOPE_MAP_NAMES[MapperScope.RESPONSE]).toBe('responseMap');
    });

    it('should have correct labels', () => {
      expect(SCOPE_LABELS[MapperScope.CONNECTOR]).toBe('Connector Map');
      expect(SCOPE_LABELS[MapperScope.CHANNEL]).toBe('Channel Map');
      expect(SCOPE_LABELS[MapperScope.GLOBAL_CHANNEL]).toBe('Global Channel Map');
      expect(SCOPE_LABELS[MapperScope.GLOBAL]).toBe('Global Map');
      expect(SCOPE_LABELS[MapperScope.RESPONSE]).toBe('Response Map');
    });
  });

  describe('setters', () => {
    it('should update all properties', () => {
      const step = new MapperStep();

      step.setSequenceNumber(5);
      step.setName('Test');
      step.setEnabled(false);
      step.setVariable('testVar');
      step.setMapping("msg['MSH']['MSH.3']");
      step.setDefaultValue("'default'");
      step.setReplacements([{ pattern: '/x/', replacement: "'y'" }]);
      step.setScope(MapperScope.RESPONSE);

      expect(step.getSequenceNumber()).toBe(5);
      expect(step.getName()).toBe('Test');
      expect(step.isEnabled()).toBe(false);
      expect(step.getVariable()).toBe('testVar');
      expect(step.getMapping()).toBe("msg['MSH']['MSH.3']");
      expect(step.getDefaultValue()).toBe("'default'");
      expect(step.getReplacements()).toHaveLength(1);
      expect(step.getScope()).toBe(MapperScope.RESPONSE);
    });
  });

  describe('clone', () => {
    it('should create a deep copy', () => {
      const original = new MapperStep({
        sequenceNumber: 1,
        name: 'Original',
        variable: 'varName',
        mapping: 'msg.field',
        defaultValue: "''",
        replacements: [{ pattern: '/a/', replacement: "'b'" }],
        scope: MapperScope.CHANNEL,
      });

      const cloned = original.clone();

      expect(cloned.getVariable()).toBe('varName');
      expect(cloned.getReplacements()).toHaveLength(1);

      // Verify it's a separate object
      cloned.setVariable('newVar');
      cloned.getReplacements()[0]!.pattern = '/x/';

      expect(original.getVariable()).toBe('varName');
      expect(original.getReplacements()[0]!.pattern).toBe('/a/');
    });
  });

  describe('getResponseVariables', () => {
    it('should return variable name for RESPONSE scope', () => {
      const step = new MapperStep({
        variable: 'responseVar',
        scope: MapperScope.RESPONSE,
      });

      expect(step.getResponseVariables()).toEqual(['responseVar']);
    });

    it('should return empty array for other scopes', () => {
      const step = new MapperStep({
        variable: 'channelVar',
        scope: MapperScope.CHANNEL,
      });

      expect(step.getResponseVariables()).toEqual([]);
    });
  });

  describe('getScript', () => {
    it('should generate basic mapping script', () => {
      const step = new MapperStep({
        variable: 'patientName',
        mapping: "msg['PID']['PID.5'].toString()",
        scope: MapperScope.CHANNEL,
      });

      const script = step.getScript();

      expect(script).toContain('var mapping;');
      expect(script).toContain("mapping = msg['PID']['PID.5'].toString()");
      expect(script).toContain("channelMap.put('patientName'");
      expect(script).toContain('validate(mapping');
    });

    it('should use correct map for different scopes', () => {
      const globalStep = new MapperStep({
        variable: 'globalVar',
        scope: MapperScope.GLOBAL,
      });

      expect(globalStep.getScript()).toContain('globalMap.put');

      const responseStep = new MapperStep({
        variable: 'responseVar',
        scope: MapperScope.RESPONSE,
      });

      expect(responseStep.getScript()).toContain('responseMap.put');
    });

    it('should include default value', () => {
      const step = new MapperStep({
        variable: 'test',
        defaultValue: "'N/A'",
      });

      expect(step.getScript()).toContain("'N/A'");
    });

    it('should include replacements array', () => {
      const step = new MapperStep({
        variable: 'test',
        replacements: [
          { pattern: '/\\s+/', replacement: "' '" },
          { pattern: '/[^a-z]/', replacement: "''" },
        ],
      });

      const script = step.getScript();
      expect(script).toContain('new Array(/\\s+/');
      expect(script).toContain("new Array(/[^a-z]/, '')");
    });

    it('should handle empty replacements', () => {
      const step = new MapperStep({
        variable: 'test',
        replacements: [],
      });

      expect(step.getScript()).toContain('new Array()');
    });
  });

  describe('iterator scripts', () => {
    it('should generate pre-script with list initialization', () => {
      const step = new MapperStep({ variable: 'items' });
      expect(step.getPreScript()).toBe('var _items = Lists.list();');
    });

    it('should sanitize variable names in pre-script', () => {
      const step = new MapperStep({ variable: 'patient-name' });
      expect(step.getPreScript()).toBe('var _patient_name = Lists.list();');
    });

    it('should generate iteration script', () => {
      const step = new MapperStep({
        variable: 'item',
        mapping: "msg['OBX'][i]",
      });

      const script = step.getIterationScript();
      expect(script).toContain('_item.add(validate');
    });

    it('should generate post-script', () => {
      const step = new MapperStep({
        variable: 'items',
        scope: MapperScope.CHANNEL,
      });

      const script = step.getPostScript();
      expect(script).toBe("channelMap.put('items', _items.toArray());");
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const step = new MapperStep({
        sequenceNumber: 1,
        name: 'Test',
        variable: 'testVar',
        mapping: 'msg.field',
        defaultValue: "''",
        replacements: [{ pattern: '/a/', replacement: "'b'" }],
        scope: MapperScope.GLOBAL_CHANNEL,
      });

      const json = step.toJSON();

      expect(json.sequenceNumber).toBe(1);
      expect(json.name).toBe('Test');
      expect(json.variable).toBe('testVar');
      expect(json.mapping).toBe('msg.field');
      expect(json.scope).toBe('GLOBAL_CHANNEL');
      expect(json.type).toBe('Mapper');
    });
  });

  describe('fromXML', () => {
    it('should parse valid data', () => {
      const step = MapperStep.fromXML({
        sequenceNumber: 2,
        name: 'Imported',
        variable: 'importedVar',
        mapping: 'msg.data',
        defaultValue: "'default'",
        replacements: [{ pattern: '/x/', replacement: "'y'" }],
        scope: 'RESPONSE',
      });

      expect(step.getVariable()).toBe('importedVar');
      expect(step.getScope()).toBe(MapperScope.RESPONSE);
      expect(step.getReplacements()).toHaveLength(1);
    });

    it('should handle missing fields', () => {
      const step = MapperStep.fromXML({});

      expect(step.getVariable()).toBe('');
      expect(step.getMapping()).toBe('');
      expect(step.getScope()).toBe(MapperScope.CHANNEL);
      expect(step.getReplacements()).toEqual([]);
    });

    it('should handle invalid scope', () => {
      const step = MapperStep.fromXML({
        scope: 'INVALID_SCOPE',
      });

      expect(step.getScope()).toBe(MapperScope.CHANNEL);
    });
  });

  describe('factory function', () => {
    it('should create step with createMapperStep', () => {
      const step = createMapperStep('ID Mapping', 'patientId', 'msg.PID', MapperScope.GLOBAL);

      expect(step.getName()).toBe('ID Mapping');
      expect(step.getVariable()).toBe('patientId');
      expect(step.getMapping()).toBe('msg.PID');
      expect(step.getScope()).toBe(MapperScope.GLOBAL);
      expect(step.isEnabled()).toBe(true);
    });

    it('should use default values', () => {
      const step = createMapperStep('Simple', 'var');

      expect(step.getMapping()).toBe('');
      expect(step.getScope()).toBe(MapperScope.CHANNEL);
    });
  });

  describe('type guards', () => {
    it('should identify MapperStep instances', () => {
      const step = new MapperStep();
      expect(isMapperStep(step)).toBe(true);
    });

    it('should reject non-MapperStep objects', () => {
      expect(isMapperStep({})).toBe(false);
      expect(isMapperStep(null)).toBe(false);
    });

    it('should check type string', () => {
      expect(isMapperStepType({ type: 'Mapper' })).toBe(true);
      expect(isMapperStepType({ type: 'JavaScript' })).toBe(false);
    });
  });

  describe('helper functions', () => {
    it('should convert scope from string', () => {
      expect(getScopeFromString('CHANNEL')).toBe(MapperScope.CHANNEL);
      expect(getScopeFromString('GLOBAL_CHANNEL')).toBe(MapperScope.GLOBAL_CHANNEL);
      expect(getScopeFromString('Global Channel')).toBe(MapperScope.GLOBAL_CHANNEL);
      expect(getScopeFromString('invalid')).toBe(MapperScope.CHANNEL);
    });

    it('should get scope label', () => {
      expect(getScopeLabel(MapperScope.CHANNEL)).toBe('Channel Map');
      expect(getScopeLabel(MapperScope.GLOBAL)).toBe('Global Map');
    });
  });

  describe('getPurgedProperties', () => {
    it('should return analytics properties', () => {
      const step = new MapperStep({
        sequenceNumber: 1,
        enabled: false,
        replacements: [{ pattern: '/a/', replacement: "'b'" }],
        scope: MapperScope.GLOBAL,
      });

      const purged = step.getPurgedProperties();

      expect(purged.sequenceNumber).toBe(1);
      expect(purged.enabled).toBe(false);
      expect(purged.replacementsCount).toBe(1);
      expect(purged.scope).toBe('GLOBAL');
    });
  });
});
