/**
 * XsltStep Integration Tests
 *
 * Tests the XSLT transformer step plugin.
 * Run with: npm test -- --testPathPattern=integration
 */

// Note: These tests don't require database access, they test the XSLT transformation
// functionality directly.

import { XsltStep } from '../../../src/plugins/xsltstep/XsltStep';
import { XsltStepProperties } from '../../../src/plugins/xsltstep/XsltStepProperties';

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

      const step = new XsltStep({
        stylesheet: xslt,
        factory: 'default',
      });

      const result = await step.transform(input);

      expect(result).toContain('<greeting>');
      expect(result).toContain('Hello, World!');
    });

    it('should handle XSLT 1.0 features', async () => {
      const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes"/>
  <xsl:template match="/">
    <items>
      <xsl:for-each select="//item">
        <processed-item>
          <xsl:attribute name="id"><xsl:value-of select="@id"/></xsl:attribute>
          <name><xsl:value-of select="name"/></name>
          <price><xsl:value-of select="price * 1.1"/></price>
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

      const step = new XsltStep({
        stylesheet: xslt,
        factory: 'default',
      });

      const result = await step.transform(input);

      expect(result).toContain('processed-item');
      expect(result).toContain('Widget');
      expect(result).toContain('11'); // 10 * 1.1
      expect(result).toContain('22'); // 20 * 1.1
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

      const step = new XsltStep({
        stylesheet: xslt,
        factory: 'default',
        parameters: {
          prefix: 'MSG',
        },
      });

      const result = await step.transform(input);

      expect(result).toContain('MSG-123');
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid XSLT', async () => {
      const invalidXslt = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <!-- Missing closing tag -->
    <output>
  </xsl:template>
</xsl:stylesheet>`;

      const step = new XsltStep({
        stylesheet: invalidXslt,
        factory: 'default',
      });

      await expect(step.transform('<input/>')).rejects.toThrow();
    });

    it('should throw error for invalid input XML', async () => {
      const xslt = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/"><output/></xsl:template>
</xsl:stylesheet>`;

      const step = new XsltStep({
        stylesheet: xslt,
        factory: 'default',
      });

      await expect(step.transform('not valid xml')).rejects.toThrow();
    });
  });

  describe('HL7 Transformation', () => {
    it('should transform HL7 XML representation', async () => {
      const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes"/>
  <xsl:template match="/">
    <ClinicalDocument xmlns="urn:hl7-org:v3">
      <recordTarget>
        <patientRole>
          <id root="2.16.840.1.113883.19.5" extension="{/HL7Message/PID/PID.3/PID.3.1}"/>
          <patient>
            <name>
              <given><xsl:value-of select="/HL7Message/PID/PID.5/PID.5.2"/></given>
              <family><xsl:value-of select="/HL7Message/PID/PID.5/PID.5.1"/></family>
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
    <MSH.9><MSH.9.1>ADT</MSH.9.1><MSH.9.2>A01</MSH.9.2></MSH.9>
  </MSH>
  <PID>
    <PID.3><PID.3.1>12345</PID.3.1></PID.3>
    <PID.5><PID.5.1>Doe</PID.5.1><PID.5.2>John</PID.5.2></PID.5>
  </PID>
</HL7Message>`;

      const step = new XsltStep({
        stylesheet: xslt,
        factory: 'default',
      });

      const result = await step.transform(hl7Xml);

      expect(result).toContain('ClinicalDocument');
      expect(result).toContain('12345');
      expect(result).toContain('John');
      expect(result).toContain('Doe');
    });
  });

  describe('Properties Configuration', () => {
    it('should create step from properties', () => {
      const props: XsltStepProperties = {
        stylesheet: '<xsl:stylesheet/>',
        factory: 'net.sf.saxon.TransformerFactoryImpl',
        useCustomFactory: true,
      };

      const step = XsltStep.fromProperties(props);

      expect(step).toBeInstanceOf(XsltStep);
    });

    it('should validate properties', () => {
      expect(() => {
        XsltStep.fromProperties({
          stylesheet: '', // Empty stylesheet should be invalid
          factory: 'default',
        });
      }).toThrow();
    });
  });
});
