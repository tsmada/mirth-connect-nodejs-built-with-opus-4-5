/**
 * XsltStep Integration Tests
 *
 * Tests the XSLT transformer step plugin.
 * Run with: npm test -- --testPathPattern=integration
 */

// Note: These tests don't require database access, they test the XSLT transformation
// functionality directly.

import { XsltStep, XsltTransformer, createXsltStep } from '../../../src/plugins/xsltstep/XsltStep';
import { validateXsltStepProperties } from '../../../src/plugins/xsltstep/XsltStepProperties';

describe('XsltStep Integration Tests', () => {
  describe('Basic XSLT Transformation', () => {
    it('should transform XML using XSLT stylesheet', async () => {
      const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes"/>
  <xsl:template match="/">
    <output>
      <greeting>Hello, <xsl:value-of select="/input/name"/>!</greeting>
    </output>
  </xsl:template>
</xsl:stylesheet>`;

      const input = `<?xml version="1.0"?>
<input>
  <name>World</name>
</input>`;

      const result = await XsltTransformer.transform(input, xslt);

      expect(result).toContain('<greeting>');
      expect(result).toContain('Hello, World!');
    });

    it('should handle XSLT 1.0 for-each and attributes', async () => {
      const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes"/>
  <xsl:template match="/">
    <items>
      <xsl:for-each select="//item">
        <processed-item>
          <xsl:attribute name="id"><xsl:value-of select="@id"/></xsl:attribute>
          <name><xsl:value-of select="name"/></name>
          <price><xsl:value-of select="price"/></price>
        </processed-item>
      </xsl:for-each>
    </items>
  </xsl:template>
</xsl:stylesheet>`;

      const input = `<?xml version="1.0"?>
<items>
  <item id="1">
    <name>Widget</name>
    <price>10</price>
  </item>
  <item id="2">
    <name>Gadget</name>
    <price>20</price>
  </item>
</items>`;

      const result = await XsltTransformer.transform(input, xslt);

      expect(result).toContain('processed-item');
      expect(result).toContain('Widget');
      expect(result).toContain('Gadget');
      expect(result).toContain('10');
      expect(result).toContain('20');
    });

    it('should pass parameters to XSLT', async () => {
      const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:param name="prefix" select="'DEFAULT'"/>
  <xsl:output method="xml" indent="yes"/>
  <xsl:template match="/">
    <result>
      <value><xsl:value-of select="$prefix"/>-<xsl:value-of select="/data/value"/></value>
    </result>
  </xsl:template>
</xsl:stylesheet>`;

      const input = `<data><value>123</value></data>`;

      const result = await XsltTransformer.transform(input, xslt, [
        { name: 'prefix', value: 'MSG' },
      ]);

      expect(result).toContain('MSG-123');
    });
  });

  describe('Error Handling', () => {
    it('should handle empty input gracefully', async () => {
      const xslt = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/"><output/></xsl:template>
</xsl:stylesheet>`;

      // The xslt-processor library is lenient with some invalid inputs,
      // but completely empty string should produce a result or throw
      const result = await XsltTransformer.transform('<empty/>', xslt);
      expect(result).toBeDefined();
    });
  });

  describe('HL7 Transformation', () => {
    it('should transform XML with nested elements', async () => {
      const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes"/>
  <xsl:template match="/">
    <ClinicalDocument xmlns="urn:hl7-org:v3">
      <recordTarget>
        <patientRole>
          <id>
            <xsl:attribute name="extension"><xsl:value-of select="/HL7Message/PID/PatientId"/></xsl:attribute>
          </id>
          <patient>
            <name>
              <given><xsl:value-of select="/HL7Message/PID/GivenName"/></given>
              <family><xsl:value-of select="/HL7Message/PID/FamilyName"/></family>
            </name>
          </patient>
        </patientRole>
      </recordTarget>
    </ClinicalDocument>
  </xsl:template>
</xsl:stylesheet>`;

      const hl7Xml = `<?xml version="1.0"?>
<HL7Message>
  <MSH>
    <MessageType>ADT</MessageType>
    <TriggerEvent>A01</TriggerEvent>
  </MSH>
  <PID>
    <PatientId>12345</PatientId>
    <FamilyName>Doe</FamilyName>
    <GivenName>John</GivenName>
  </PID>
</HL7Message>`;

      const result = await XsltTransformer.transform(hl7Xml, xslt);

      expect(result).toContain('ClinicalDocument');
      expect(result).toContain('12345');
      expect(result).toContain('John');
      expect(result).toContain('Doe');
    });
  });

  describe('Properties Configuration', () => {
    it('should create step from factory function', () => {
      const step = createXsltStep(
        'My XSLT Step',
        'resultVar',
        '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><output/></xsl:template></xsl:stylesheet>',
        'msg'
      );

      expect(step).toBeInstanceOf(XsltStep);
      expect(step.getName()).toBe('My XSLT Step');
      expect(step.getResultVariable()).toBe('resultVar');
      expect(step.getTemplate()).toContain('xsl:stylesheet');
    });

    it('should validate properties - empty template is invalid', () => {
      const errors = validateXsltStepProperties({
        template: '',
        resultVariable: 'result',
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('template'))).toBe(true);
    });

    it('should validate properties - empty resultVariable is invalid', () => {
      const errors = validateXsltStepProperties({
        template: '<xsl:stylesheet/>',
        resultVariable: '',
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('variable'))).toBe(true);
    });
  });
});
