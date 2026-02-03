import {
  XsltStep,
  XsltTransformer,
  createXsltStep,
  isXsltStep,
  isXsltStepType,
  XSLT_STEP_PLUGIN_POINT,
} from '../../../../src/plugins/xsltstep/XsltStep';
import {
  validateXsltStepProperties,
  mergeWithDefaults,
  DEFAULT_XSLT_STEP_PROPERTIES,
} from '../../../../src/plugins/xsltstep/XsltStepProperties';

describe('XsltStep', () => {
  describe('constructor', () => {
    it('should create step with default values', () => {
      const step = new XsltStep();

      expect(step.getSequenceNumber()).toBe(0);
      expect(step.getName()).toBe('');
      expect(step.isEnabled()).toBe(true);
      expect(step.getSourceXml()).toBe('');
      expect(step.getResultVariable()).toBe('');
      expect(step.getTemplate()).toBe('');
      expect(step.isUseCustomFactory()).toBe(false);
      expect(step.getCustomFactory()).toBe('');
      expect(step.getType()).toBe('XSLT Step');
    });

    it('should create step with provided values', () => {
      const step = new XsltStep({
        sequenceNumber: 1,
        name: 'Transform Patient',
        enabled: true,
        sourceXml: 'msg.toString()',
        resultVariable: 'transformedXml',
        template: '<?xml version="1.0"?><xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"></xsl:stylesheet>',
        useCustomFactory: false,
        customFactory: '',
      });

      expect(step.getSequenceNumber()).toBe(1);
      expect(step.getName()).toBe('Transform Patient');
      expect(step.isEnabled()).toBe(true);
      expect(step.getSourceXml()).toBe('msg.toString()');
      expect(step.getResultVariable()).toBe('transformedXml');
      expect(step.getTemplate()).toContain('xsl:stylesheet');
    });
  });

  describe('PLUGIN_POINT', () => {
    it('should have correct plugin point', () => {
      expect(XsltStep.PLUGIN_POINT).toBe('XSLT Step');
      expect(XSLT_STEP_PLUGIN_POINT).toBe('XSLT Step');
    });
  });

  describe('setters', () => {
    it('should update sequence number', () => {
      const step = new XsltStep();
      step.setSequenceNumber(5);
      expect(step.getSequenceNumber()).toBe(5);
    });

    it('should update name', () => {
      const step = new XsltStep();
      step.setName('My XSLT Step');
      expect(step.getName()).toBe('My XSLT Step');
    });

    it('should update sourceXml', () => {
      const step = new XsltStep();
      step.setSourceXml('channelMap.get("inputXml")');
      expect(step.getSourceXml()).toBe('channelMap.get("inputXml")');
    });

    it('should update resultVariable', () => {
      const step = new XsltStep();
      step.setResultVariable('outputXml');
      expect(step.getResultVariable()).toBe('outputXml');
    });

    it('should update template', () => {
      const xslt = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>';
      const step = new XsltStep();
      step.setTemplate(xslt);
      expect(step.getTemplate()).toBe(xslt);
    });

    it('should update enabled', () => {
      const step = new XsltStep();
      step.setEnabled(false);
      expect(step.isEnabled()).toBe(false);
    });

    it('should update useCustomFactory', () => {
      const step = new XsltStep();
      step.setUseCustomFactory(true);
      expect(step.isUseCustomFactory()).toBe(true);
    });

    it('should update customFactory', () => {
      const step = new XsltStep();
      step.setCustomFactory('com.example.CustomFactory');
      expect(step.getCustomFactory()).toBe('com.example.CustomFactory');
    });
  });

  describe('clone', () => {
    it('should create a deep copy', () => {
      const original = new XsltStep({
        sequenceNumber: 1,
        name: 'Original',
        sourceXml: 'msg',
        resultVariable: 'result',
        template: '<xsl:stylesheet/>',
        enabled: true,
      });

      const cloned = original.clone();

      expect(cloned.getSequenceNumber()).toBe(1);
      expect(cloned.getName()).toBe('Original');
      expect(cloned.getSourceXml()).toBe('msg');
      expect(cloned.getResultVariable()).toBe('result');
      expect(cloned.getTemplate()).toBe('<xsl:stylesheet/>');
      expect(cloned.isEnabled()).toBe(true);

      // Verify it's a separate object
      cloned.setName('Cloned');
      expect(original.getName()).toBe('Original');
      expect(cloned.getName()).toBe('Cloned');
    });
  });

  describe('getScript', () => {
    it('should generate transformation script', () => {
      const step = new XsltStep({
        sourceXml: 'msg.toString()',
        resultVariable: 'transformedXml',
        template: '"<xsl:stylesheet/>"',
      });

      const script = step.getScript();

      expect(script).toContain('var xsltTemplate = "<xsl:stylesheet/>"');
      expect(script).toContain('var sourceVar = msg.toString()');
      expect(script).toContain('XsltTransformer.transform');
      expect(script).toContain("channelMap.put('transformedXml', resultVar)");
    });

    it('should use default source expression when sourceXml is empty', () => {
      const step = new XsltStep({
        sourceXml: '',
        resultVariable: 'result',
        template: '"<xsl:stylesheet/>"',
      });

      const script = step.getScript();

      expect(script).toContain('var sourceVar = msg.toString()');
    });
  });

  describe('iterator scripts', () => {
    it('should generate pre-script for iterator', () => {
      const step = new XsltStep({
        resultVariable: 'transformedXml',
      });

      const preScript = step.getPreScript();

      expect(preScript).toBe('var _transformedXml = Lists.list();');
    });

    it('should generate iteration script', () => {
      const step = new XsltStep({
        sourceXml: 'msg.toString()',
        resultVariable: 'transformedXml',
        template: '"<xsl:stylesheet/>"',
      });

      const iterationScript = step.getIterationScript();

      expect(iterationScript).toContain('XsltTransformer.transform');
      expect(iterationScript).toContain('_transformedXml.add(resultVar)');
    });

    it('should generate post-script for iterator', () => {
      const step = new XsltStep({
        resultVariable: 'transformedXml',
      });

      const postScript = step.getPostScript();

      expect(postScript).toBe("channelMap.put('transformedXml', _transformedXml.toArray());\n");
    });

    it('should convert special characters in variable name to underscores', () => {
      const step = new XsltStep({
        resultVariable: 'my-result.variable',
      });

      const preScript = step.getPreScript();

      expect(preScript).toBe('var _my_result_variable = Lists.list();');
    });
  });

  describe('getResponseVariables', () => {
    it('should return empty array (XSLT steps do not set response variables)', () => {
      const step = new XsltStep({
        resultVariable: 'transformedXml',
        template: '<xsl:stylesheet/>',
      });

      expect(step.getResponseVariables()).toEqual([]);
    });
  });

  describe('getPurgedProperties', () => {
    it('should return purged properties', () => {
      const step = new XsltStep({
        sequenceNumber: 1,
        enabled: true,
        template: 'line1\nline2\nline3',
        useCustomFactory: false,
      });

      const purged = step.getPurgedProperties();

      expect(purged).toEqual({
        sequenceNumber: 1,
        enabled: true,
        templateLines: 3,
        useCustomFactory: false,
      });
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const step = new XsltStep({
        sequenceNumber: 1,
        name: 'Test Step',
        enabled: true,
        sourceXml: 'msg',
        resultVariable: 'result',
        template: '<xsl:stylesheet/>',
        useCustomFactory: false,
        customFactory: '',
      });

      const json = step.toJSON();

      expect(json).toEqual({
        sequenceNumber: 1,
        name: 'Test Step',
        enabled: true,
        sourceXml: 'msg',
        resultVariable: 'result',
        template: '<xsl:stylesheet/>',
        useCustomFactory: false,
        customFactory: '',
        type: 'XSLT Step',
      });
    });
  });

  describe('fromXML', () => {
    it('should create step from XML data', () => {
      const data = {
        sequenceNumber: 2,
        name: 'Imported Step',
        enabled: true,
        sourceXml: 'channelMap.get("input")',
        resultVariable: 'output',
        template: '<xsl:stylesheet version="1.0"/>',
        useCustomFactory: false,
        customFactory: '',
      };

      const step = XsltStep.fromXML(data);

      expect(step.getSequenceNumber()).toBe(2);
      expect(step.getName()).toBe('Imported Step');
      expect(step.isEnabled()).toBe(true);
      expect(step.getSourceXml()).toBe('channelMap.get("input")');
      expect(step.getResultVariable()).toBe('output');
      expect(step.getTemplate()).toBe('<xsl:stylesheet version="1.0"/>');
    });

    it('should handle missing fields with defaults', () => {
      const step = XsltStep.fromXML({});

      expect(step.getSequenceNumber()).toBe(0);
      expect(step.getName()).toBe('');
      expect(step.isEnabled()).toBe(true);
      expect(step.getSourceXml()).toBe('');
      expect(step.getResultVariable()).toBe('');
      expect(step.getTemplate()).toBe('');
    });
  });
});

describe('XsltStepProperties', () => {
  describe('validateXsltStepProperties', () => {
    it('should return errors for missing required fields', () => {
      const errors = validateXsltStepProperties({});

      expect(errors).toContain('Result variable name is required');
      expect(errors).toContain('XSLT template is required');
    });

    it('should return no errors for valid properties', () => {
      const errors = validateXsltStepProperties({
        resultVariable: 'output',
        template: '<xsl:stylesheet/>',
      });

      expect(errors).toEqual([]);
    });

    it('should reject empty strings', () => {
      const errors = validateXsltStepProperties({
        resultVariable: '   ',
        template: '',
      });

      expect(errors.length).toBe(2);
    });
  });

  describe('mergeWithDefaults', () => {
    it('should merge properties with defaults', () => {
      const merged = mergeWithDefaults({
        name: 'Custom Step',
        resultVariable: 'output',
      });

      expect(merged.name).toBe('Custom Step');
      expect(merged.resultVariable).toBe('output');
      expect(merged.enabled).toBe(true);
      expect(merged.sourceXml).toBe('');
      expect(merged.template).toBe('');
      expect(merged.useCustomFactory).toBe(false);
      expect(merged.customFactory).toBe('');
      expect(merged.sequenceNumber).toBe(0);
    });
  });

  describe('DEFAULT_XSLT_STEP_PROPERTIES', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_XSLT_STEP_PROPERTIES.name).toBe('');
      expect(DEFAULT_XSLT_STEP_PROPERTIES.enabled).toBe(true);
      expect(DEFAULT_XSLT_STEP_PROPERTIES.sourceXml).toBe('');
      expect(DEFAULT_XSLT_STEP_PROPERTIES.resultVariable).toBe('');
      expect(DEFAULT_XSLT_STEP_PROPERTIES.template).toBe('');
      expect(DEFAULT_XSLT_STEP_PROPERTIES.useCustomFactory).toBe(false);
      expect(DEFAULT_XSLT_STEP_PROPERTIES.customFactory).toBe('');
    });
  });
});

describe('XsltTransformer', () => {
  describe('transform', () => {
    it('should transform XML with identity stylesheet', async () => {
      const sourceXml = '<root><item>Hello</item></root>';
      const xsltStylesheet = `
        <?xml version="1.0" encoding="UTF-8"?>
        <xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
          <xsl:template match="@*|node()">
            <xsl:copy>
              <xsl:apply-templates select="@*|node()"/>
            </xsl:copy>
          </xsl:template>
        </xsl:stylesheet>
      `;

      const result = await XsltTransformer.transform(sourceXml, xsltStylesheet);

      expect(result).toContain('<root>');
      expect(result).toContain('<item>Hello</item>');
      expect(result).toContain('</root>');
    });

    it('should transform XML with element renaming', async () => {
      const sourceXml = '<old>content</old>';
      const xsltStylesheet = `
        <?xml version="1.0" encoding="UTF-8"?>
        <xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
          <xsl:template match="old">
            <new><xsl:value-of select="."/></new>
          </xsl:template>
        </xsl:stylesheet>
      `;

      const result = await XsltTransformer.transform(sourceXml, xsltStylesheet);

      expect(result).toContain('<new>content</new>');
      expect(result).not.toContain('<old>');
    });

    it('should transform XML with value extraction', async () => {
      const sourceXml = '<patient><name>John Doe</name><id>12345</id></patient>';
      const xsltStylesheet = `
        <?xml version="1.0" encoding="UTF-8"?>
        <xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
          <xsl:template match="patient">
            <record>
              <patientName><xsl:value-of select="name"/></patientName>
              <patientId><xsl:value-of select="id"/></patientId>
            </record>
          </xsl:template>
        </xsl:stylesheet>
      `;

      const result = await XsltTransformer.transform(sourceXml, xsltStylesheet);

      expect(result).toContain('<record>');
      expect(result).toContain('<patientName>John Doe</patientName>');
      expect(result).toContain('<patientId>12345</patientId>');
    });

    it('should transform XML with conditional logic', async () => {
      const sourceXml = '<items><item status="active">A</item><item status="inactive">B</item></items>';
      const xsltStylesheet = `
        <?xml version="1.0" encoding="UTF-8"?>
        <xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
          <xsl:template match="items">
            <activeItems>
              <xsl:for-each select="item[@status='active']">
                <active><xsl:value-of select="."/></active>
              </xsl:for-each>
            </activeItems>
          </xsl:template>
        </xsl:stylesheet>
      `;

      const result = await XsltTransformer.transform(sourceXml, xsltStylesheet);

      expect(result).toContain('<activeItems>');
      expect(result).toContain('<active>A</active>');
      expect(result).not.toContain('B');
    });

    it('should handle XSLT with parameters', async () => {
      const sourceXml = '<root><value>test</value></root>';
      const xsltStylesheet = `
        <?xml version="1.0" encoding="UTF-8"?>
        <xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
          <xsl:param name="prefix" select="'default'"/>
          <xsl:template match="root">
            <output>
              <prefixed><xsl:value-of select="concat($prefix, '-', value)"/></prefixed>
            </output>
          </xsl:template>
        </xsl:stylesheet>
      `;

      const result = await XsltTransformer.transform(sourceXml, xsltStylesheet, [
        { name: 'prefix', value: 'custom' },
      ]);

      expect(result).toContain('<prefixed>custom-test</prefixed>');
    });

    it('should handle empty source XML gracefully', async () => {
      const emptyXml = '';
      const xsltStylesheet = `
        <?xml version="1.0" encoding="UTF-8"?>
        <xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
          <xsl:template match="/">
            <output/>
          </xsl:template>
        </xsl:stylesheet>
      `;

      // The library may handle empty XML in various ways
      // We just verify it doesn't crash
      const result = await XsltTransformer.transform(emptyXml, xsltStylesheet);
      expect(typeof result).toBe('string');
    });

    it('should handle non-XSLT stylesheet as identity-like transform', async () => {
      // xslt-processor is lenient and processes non-XSLT XML as-is
      const sourceXml = '<root/>';
      const invalidXslt = '<not-valid-xslt/>';

      // The library is lenient - it returns the stylesheet as output
      const result = await XsltTransformer.transform(sourceXml, invalidXslt);
      expect(typeof result).toBe('string');
    });
  });
});

describe('Factory and type guards', () => {
  describe('createXsltStep', () => {
    it('should create step with name and result variable', () => {
      const step = createXsltStep('My Step', 'output');

      expect(step.getName()).toBe('My Step');
      expect(step.getResultVariable()).toBe('output');
      expect(step.isEnabled()).toBe(true);
    });

    it('should create step with all parameters', () => {
      const step = createXsltStep(
        'Full Step',
        'result',
        '<xsl:stylesheet/>',
        'msg.toString()'
      );

      expect(step.getName()).toBe('Full Step');
      expect(step.getResultVariable()).toBe('result');
      expect(step.getTemplate()).toBe('<xsl:stylesheet/>');
      expect(step.getSourceXml()).toBe('msg.toString()');
    });
  });

  describe('isXsltStep', () => {
    it('should return true for XsltStep instances', () => {
      const step = new XsltStep();
      expect(isXsltStep(step)).toBe(true);
    });

    it('should return false for non-XsltStep objects', () => {
      expect(isXsltStep({})).toBe(false);
      expect(isXsltStep(null)).toBe(false);
      expect(isXsltStep('step')).toBe(false);
    });
  });

  describe('isXsltStepType', () => {
    it('should return true for XSLT Step type', () => {
      expect(isXsltStepType({ type: 'XSLT Step' })).toBe(true);
    });

    it('should return false for other types', () => {
      expect(isXsltStepType({ type: 'JavaScript' })).toBe(false);
      expect(isXsltStepType({ type: 'Mapper' })).toBe(false);
      expect(isXsltStepType({})).toBe(false);
    });
  });
});
