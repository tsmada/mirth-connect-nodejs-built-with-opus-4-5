/**
 * Unit tests for HL7v3 Data Type
 *
 * Tests cover:
 * - HL7V3Serializer serialization and metadata extraction
 * - HL7V3BatchAdaptor batch processing
 * - Namespace stripping functionality
 * - Property handling
 */

import {
  HL7V3Serializer,
  HL7V3BatchAdaptor,
  HL7V3SplitType,
  extractHL7V3MetaData,
  parseHL7V3,
  stripHL7V3Namespaces,
  getDefaultHL7V3DataTypeProperties,
  getDefaultHL7V3SerializationProperties,
  getDefaultHL7V3BatchProperties,
  splitByDelimiter,
  splitByXMLRoot,
  BatchScriptContext,
} from '../../../src/datatypes/hl7v3/index.js';

// Sample HL7v3 messages for testing
const SAMPLE_PRPA_MESSAGE = `<?xml version="1.0" encoding="UTF-8"?>
<PRPA_IN201301UV02 xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ITSVersion="XML_1.0">
  <id root="2.16.840.1.113883.19.1122.7" extension="CDAR2"/>
  <creationTime value="20231015120000"/>
  <interactionId root="2.16.840.1.113883.1.6" extension="PRPA_IN201301UV02"/>
  <processingCode code="P"/>
  <processingModeCode code="T"/>
  <acceptAckCode code="AL"/>
  <receiver typeCode="RCV">
    <device classCode="DEV" determinerCode="INSTANCE">
      <id root="2.16.840.1.113883.19.1122.1"/>
    </device>
  </receiver>
  <sender typeCode="SND">
    <device classCode="DEV" determinerCode="INSTANCE">
      <id root="2.16.840.1.113883.19.1122.2"/>
    </device>
  </sender>
  <controlActProcess classCode="CACT" moodCode="EVN">
    <subject typeCode="SUBJ">
      <registrationEvent classCode="REG" moodCode="EVN">
        <subject1 typeCode="SBJ">
          <patient classCode="PAT">
            <id root="2.16.840.1.113883.4.1" extension="123-45-6789"/>
            <patientPerson classCode="PSN" determinerCode="INSTANCE">
              <name>
                <given>John</given>
                <family>Smith</family>
              </name>
              <administrativeGenderCode code="M"/>
              <birthTime value="19800515"/>
            </patientPerson>
          </patient>
        </subject1>
      </registrationEvent>
    </subject>
  </controlActProcess>
</PRPA_IN201301UV02>`;

const SAMPLE_CDA_DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1"/>
  <id root="2.16.840.1.113883.19.5.99999.1"/>
  <code code="34133-9" codeSystem="2.16.840.1.113883.6.1" displayName="Summarization of Episode Note"/>
  <title>Patient Summary</title>
  <effectiveTime value="20231015"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-US"/>
  <recordTarget>
    <patientRole>
      <id extension="98765432" root="2.16.840.1.113883.4.1"/>
      <patient>
        <name>
          <given>Jane</given>
          <family>Doe</family>
        </name>
      </patient>
    </patientRole>
  </recordTarget>
</ClinicalDocument>`;

const SAMPLE_ACK_MESSAGE = `<?xml version="1.0" encoding="UTF-8"?>
<MCCI_IN000002UV01 xmlns="urn:hl7-org:v3">
  <id root="2.16.840.1.113883.19.1122.7" extension="ACK001"/>
  <creationTime value="20231015120100"/>
  <acknowledgement>
    <typeCode code="AA"/>
    <targetMessage>
      <id root="2.16.840.1.113883.19.1122.7" extension="CDAR2"/>
    </targetMessage>
  </acknowledgement>
</MCCI_IN000002UV01>`;

const SIMPLE_HL7V3 = `<PRPA_IN201301UV02 xmlns="urn:hl7-org:v3"><id root="test"/></PRPA_IN201301UV02>`;

describe('HL7V3 Data Type', () => {
  describe('HL7V3Serializer', () => {
    describe('constructor', () => {
      it('should use default properties when none provided', () => {
        const serializer = new HL7V3Serializer();
        // Verify via behavior - no namespace stripping by default
        const result = serializer.toXML(SIMPLE_HL7V3);
        expect(result).toContain('xmlns="urn:hl7-org:v3"');
      });

      it('should accept custom properties', () => {
        const serializer = new HL7V3Serializer({ stripNamespaces: true });
        const result = serializer.toXML(SIMPLE_HL7V3);
        expect(result).not.toContain('xmlns=');
      });
    });

    describe('isSerializationRequired', () => {
      it('should always return false', () => {
        const serializer = new HL7V3Serializer();
        expect(serializer.isSerializationRequired()).toBe(false);
        expect(serializer.isSerializationRequired(true)).toBe(false);
        expect(serializer.isSerializationRequired(false)).toBe(false);
      });
    });

    describe('toXML', () => {
      it('should trim whitespace', () => {
        const serializer = new HL7V3Serializer();
        const result = serializer.toXML('   ' + SIMPLE_HL7V3 + '   \n');
        expect(result).toBe(SIMPLE_HL7V3);
      });

      it('should preserve message when stripNamespaces is false', () => {
        const serializer = new HL7V3Serializer({ stripNamespaces: false });
        const result = serializer.toXML(SAMPLE_PRPA_MESSAGE);
        expect(result).toContain('xmlns="urn:hl7-org:v3"');
        expect(result).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
      });

      it('should strip namespaces when stripNamespaces is true', () => {
        const serializer = new HL7V3Serializer({ stripNamespaces: true });
        const result = serializer.toXML(SAMPLE_PRPA_MESSAGE);
        expect(result).not.toContain('xmlns="urn:hl7-org:v3"');
        expect(result).not.toContain('xmlns:xsi=');
        // Element names should be preserved
        expect(result).toContain('<PRPA_IN201301UV02');
        expect(result).toContain('<patient');
        expect(result).toContain('<name>');
      });

      it('should handle CDA documents', () => {
        const serializer = new HL7V3Serializer({ stripNamespaces: true });
        const result = serializer.toXML(SAMPLE_CDA_DOCUMENT);
        expect(result).not.toContain('xmlns=');
        expect(result).toContain('<ClinicalDocument');
        expect(result).toContain('<recordTarget>');
      });
    });

    describe('fromXML', () => {
      it('should pass through unchanged', () => {
        const serializer = new HL7V3Serializer();
        const result = serializer.fromXML(SAMPLE_PRPA_MESSAGE);
        expect(result).toBe(SAMPLE_PRPA_MESSAGE);
      });
    });

    describe('transformWithoutSerializing', () => {
      it('should return null when stripNamespaces is false', () => {
        const serializer = new HL7V3Serializer({ stripNamespaces: false });
        const result = serializer.transformWithoutSerializing(SIMPLE_HL7V3);
        expect(result).toBeNull();
      });

      it('should strip namespaces when stripNamespaces is true', () => {
        const serializer = new HL7V3Serializer({ stripNamespaces: true });
        const result = serializer.transformWithoutSerializing(SIMPLE_HL7V3);
        expect(result).not.toBeNull();
        expect(result).not.toContain('xmlns=');
      });
    });

    describe('toJSON/fromJSON', () => {
      it('should return null for toJSON', () => {
        const serializer = new HL7V3Serializer();
        expect(serializer.toJSON(SIMPLE_HL7V3)).toBeNull();
      });

      it('should return null for fromJSON', () => {
        const serializer = new HL7V3Serializer();
        expect(serializer.fromJSON('{}')).toBeNull();
      });
    });

    describe('getMetaData', () => {
      it('should extract version as 3.0', () => {
        const serializer = new HL7V3Serializer();
        const metadata = serializer.getMetaData(SAMPLE_PRPA_MESSAGE);
        expect(metadata.version).toBe('3.0');
      });

      it('should extract PRPA message type', () => {
        const serializer = new HL7V3Serializer();
        const metadata = serializer.getMetaData(SAMPLE_PRPA_MESSAGE);
        expect(metadata.type).toBe('PRPA_IN201301UV02');
      });

      it('should extract ClinicalDocument type', () => {
        const serializer = new HL7V3Serializer();
        const metadata = serializer.getMetaData(SAMPLE_CDA_DOCUMENT);
        expect(metadata.type).toBe('ClinicalDocument');
      });

      it('should extract MCCI acknowledgment type', () => {
        const serializer = new HL7V3Serializer();
        const metadata = serializer.getMetaData(SAMPLE_ACK_MESSAGE);
        expect(metadata.type).toBe('MCCI_IN000002UV01');
      });

      it('should handle messages without XML declaration', () => {
        const messageNoDeclaration = `<PRPA_IN201305UV02 xmlns="urn:hl7-org:v3"><id root="test"/></PRPA_IN201305UV02>`;
        const serializer = new HL7V3Serializer();
        const metadata = serializer.getMetaData(messageNoDeclaration);
        expect(metadata.type).toBe('PRPA_IN201305UV02');
        expect(metadata.version).toBe('3.0');
      });

      it('should handle messages with comments before root', () => {
        const messageWithComment = `<!-- Comment --><TestMessage><data/></TestMessage>`;
        const serializer = new HL7V3Serializer();
        const metadata = serializer.getMetaData(messageWithComment);
        expect(metadata.type).toBe('TestMessage');
      });

      it('should handle messages with namespace prefix', () => {
        const messageWithPrefix = `<hl7:PRPA_IN201301UV02 xmlns:hl7="urn:hl7-org:v3"><hl7:id root="test"/></hl7:PRPA_IN201301UV02>`;
        const serializer = new HL7V3Serializer();
        const metadata = serializer.getMetaData(messageWithPrefix);
        expect(metadata.type).toBe('hl7:PRPA_IN201301UV02');
      });
    });

    describe('getMetaDataFromMessage', () => {
      it('should return Map with version and type', () => {
        const serializer = new HL7V3Serializer();
        const metadata = serializer.getMetaDataFromMessage(SAMPLE_PRPA_MESSAGE);
        expect(metadata.get('version')).toBe('3.0');
        expect(metadata.get('type')).toBe('PRPA_IN201301UV02');
      });
    });
  });

  describe('Convenience Functions', () => {
    describe('parseHL7V3', () => {
      it('should parse with default properties', () => {
        const result = parseHL7V3(SIMPLE_HL7V3);
        expect(result).toContain('xmlns=');
      });

      it('should parse with custom properties', () => {
        const result = parseHL7V3(SIMPLE_HL7V3, { stripNamespaces: true });
        expect(result).not.toContain('xmlns=');
      });
    });

    describe('extractHL7V3MetaData', () => {
      it('should extract metadata', () => {
        const metadata = extractHL7V3MetaData(SAMPLE_PRPA_MESSAGE);
        expect(metadata.version).toBe('3.0');
        expect(metadata.type).toBe('PRPA_IN201301UV02');
      });
    });

    describe('stripHL7V3Namespaces', () => {
      it('should strip all namespace declarations', () => {
        const result = stripHL7V3Namespaces(SAMPLE_PRPA_MESSAGE);
        expect(result).not.toContain('xmlns=');
        expect(result).not.toContain('xmlns:xsi=');
        expect(result).toContain('<PRPA_IN201301UV02');
      });

      it('should handle single quotes', () => {
        const xml = `<root xmlns='urn:test'><child/></root>`;
        const result = stripHL7V3Namespaces(xml);
        expect(result).not.toContain('xmlns=');
        expect(result).toContain('<root');
      });
    });
  });

  describe('HL7V3BatchAdaptor', () => {
    describe('constructor', () => {
      it('should use default properties when none provided', () => {
        const adaptor = new HL7V3BatchAdaptor();
        expect(adaptor.getBatchProperties().splitType).toBe(HL7V3SplitType.JavaScript);
        expect(adaptor.getBatchProperties().batchScript).toBe('');
      });

      it('should accept custom properties', () => {
        const adaptor = new HL7V3BatchAdaptor({
          splitType: HL7V3SplitType.JavaScript,
          batchScript: 'return reader.readLine();',
        });
        expect(adaptor.getBatchProperties().batchScript).toBe('return reader.readLine();');
      });
    });

    describe('setBatchProperties', () => {
      it('should update batch properties', () => {
        const adaptor = new HL7V3BatchAdaptor();
        adaptor.setBatchProperties({
          splitType: HL7V3SplitType.JavaScript,
          batchScript: 'custom script',
        });
        expect(adaptor.getBatchProperties().batchScript).toBe('custom script');
      });
    });

    describe('initialize', () => {
      it('should accept string source', () => {
        const adaptor = new HL7V3BatchAdaptor();
        expect(() => adaptor.initialize('test content')).not.toThrow();
      });

      it('should accept Buffer source', () => {
        const adaptor = new HL7V3BatchAdaptor();
        expect(() => adaptor.initialize(Buffer.from('test content'))).not.toThrow();
      });
    });

    describe('getNextMessage with custom script function', () => {
      it('should execute batch script function', async () => {
        const adaptor = new HL7V3BatchAdaptor();
        const messages = ['<msg1/>', '<msg2/>', '<msg3/>'];
        let index = 0;

        adaptor.initialize('dummy');
        adaptor.setBatchScriptFunction(async (_ctx: BatchScriptContext) => {
          if (index < messages.length) {
            return messages[index++] ?? null;
          }
          return null;
        });

        const result1 = await adaptor.getNextMessage();
        const result2 = await adaptor.getNextMessage();
        const result3 = await adaptor.getNextMessage();
        const result4 = await adaptor.getNextMessage();

        expect(result1).toBe('<msg1/>');
        expect(result2).toBe('<msg2/>');
        expect(result3).toBe('<msg3/>');
        expect(result4).toBeNull();
      });

      it('should provide reader to script', async () => {
        const adaptor = new HL7V3BatchAdaptor();
        adaptor.initialize('line1\nline2\nline3');

        let capturedLine: string | null = null;
        adaptor.setBatchScriptFunction(async (ctx: BatchScriptContext) => {
          capturedLine = await ctx.reader.readLine();
          return capturedLine;
        });

        await adaptor.getNextMessage();
        expect(capturedLine).toBe('line1');
      });

      it('should provide sourceMap to script', async () => {
        const sourceMap = new Map<string, unknown>([
          ['channelId', 'test-channel'],
          ['sourceType', 'FILE'],
        ]);
        const adaptor = new HL7V3BatchAdaptor(undefined, sourceMap);
        adaptor.initialize('test');

        // Use object wrapper to avoid TypeScript narrowing issues
        const captured: { sourceMap: Map<string, unknown> | null } = { sourceMap: null };
        adaptor.setBatchScriptFunction(async (ctx: BatchScriptContext) => {
          captured.sourceMap = ctx.sourceMap;
          return null;
        });

        await adaptor.getNextMessage();
        expect(captured.sourceMap).not.toBeNull();
        expect(captured.sourceMap!.get('channelId')).toBe('test-channel');
        expect(captured.sourceMap!.get('sourceType')).toBe('FILE');
      });
    });

    describe('getNextMessage error handling', () => {
      it('should throw if not initialized', async () => {
        const adaptor = new HL7V3BatchAdaptor();
        adaptor.setBatchScriptFunction(async () => null);

        await expect(adaptor.getNextMessage()).rejects.toThrow(
          'Batch adaptor not initialized'
        );
      });

      it('should throw if no batch script set', async () => {
        const adaptor = new HL7V3BatchAdaptor();
        adaptor.initialize('test');

        await expect(adaptor.getNextMessage()).rejects.toThrow(
          'No batch script was set'
        );
      });
    });

    describe('getAllMessages', () => {
      it('should collect all messages from batch', async () => {
        const adaptor = new HL7V3BatchAdaptor();
        const messages = ['<msg1/>', '<msg2/>'];
        let index = 0;

        adaptor.initialize('dummy');
        adaptor.setBatchScriptFunction(async () => {
          if (index < messages.length) {
            return messages[index++] ?? null;
          }
          return null;
        });

        const result = await adaptor.getAllMessages();
        expect(result).toEqual(['<msg1/>', '<msg2/>']);
      });
    });

    describe('async iterator', () => {
      it('should support for-await-of', async () => {
        const adaptor = new HL7V3BatchAdaptor();
        const messages = ['<msg1/>', '<msg2/>'];
        let index = 0;

        adaptor.initialize('dummy');
        adaptor.setBatchScriptFunction(async () => {
          if (index < messages.length) {
            return messages[index++] ?? null;
          }
          return null;
        });

        const results: string[] = [];
        for await (const msg of adaptor) {
          results.push(msg);
        }

        expect(results).toEqual(['<msg1/>', '<msg2/>']);
      });
    });

    describe('cleanup', () => {
      it('should reset state', () => {
        const adaptor = new HL7V3BatchAdaptor();
        adaptor.initialize('test');
        adaptor.setBatchScriptFunction(async () => null);
        adaptor.cleanup();

        // After cleanup, should need to initialize again
        adaptor.setBatchScriptFunction(async () => 'test');
        expect(adaptor.getNextMessage()).rejects.toThrow('not initialized');
      });
    });
  });

  describe('Batch Helper Functions', () => {
    describe('splitByDelimiter', () => {
      it('should split by newline delimiter', () => {
        const batch = '<msg1/>\n<msg2/>\n<msg3/>';
        const result = splitByDelimiter(batch, '\n');
        expect(result).toEqual(['<msg1/>', '<msg2/>', '<msg3/>']);
      });

      it('should split by custom delimiter', () => {
        const batch = '<msg1/><!-- SEP --><msg2/><!-- SEP --><msg3/>';
        const result = splitByDelimiter(batch, '<!-- SEP -->');
        expect(result).toEqual(['<msg1/>', '<msg2/>', '<msg3/>']);
      });

      it('should filter empty messages', () => {
        const batch = '<msg1/>\n\n<msg2/>\n\n\n<msg3/>';
        const result = splitByDelimiter(batch, '\n');
        expect(result).toEqual(['<msg1/>', '<msg2/>', '<msg3/>']);
      });

      it('should trim whitespace from messages', () => {
        const batch = '  <msg1/>  \n  <msg2/>  ';
        const result = splitByDelimiter(batch, '\n');
        expect(result).toEqual(['<msg1/>', '<msg2/>']);
      });
    });

    describe('splitByXMLRoot', () => {
      it('should split by any root element', () => {
        const batch = '<msg1><data/></msg1><msg2><data/></msg2>';
        const result = splitByXMLRoot(batch);
        expect(result).toEqual(['<msg1><data/></msg1>', '<msg2><data/></msg2>']);
      });

      it('should split by specific root element name', () => {
        const batch = '<header/><PRPA_IN201301UV02><id/></PRPA_IN201301UV02><footer/><PRPA_IN201301UV02><id/></PRPA_IN201301UV02>';
        const result = splitByXMLRoot(batch, 'PRPA_IN201301UV02');
        expect(result).toEqual([
          '<PRPA_IN201301UV02><id/></PRPA_IN201301UV02>',
          '<PRPA_IN201301UV02><id/></PRPA_IN201301UV02>',
        ]);
      });

      it('should handle elements with attributes', () => {
        const batch = '<msg attr="value"><child/></msg><msg attr="other"><child/></msg>';
        const result = splitByXMLRoot(batch, 'msg');
        expect(result).toHaveLength(2);
        expect(result[0]).toContain('attr="value"');
        expect(result[1]).toContain('attr="other"');
      });
    });
  });

  describe('Property Functions', () => {
    describe('getDefaultHL7V3DataTypeProperties', () => {
      it('should return correct defaults', () => {
        const props = getDefaultHL7V3DataTypeProperties();
        expect(props.serializationProperties.stripNamespaces).toBe(false);
        expect(props.batchProperties.splitType).toBe(HL7V3SplitType.JavaScript);
        expect(props.batchProperties.batchScript).toBe('');
      });
    });

    describe('getDefaultHL7V3SerializationProperties', () => {
      it('should return correct defaults', () => {
        const props = getDefaultHL7V3SerializationProperties();
        expect(props.stripNamespaces).toBe(false);
      });
    });

    describe('getDefaultHL7V3BatchProperties', () => {
      it('should return correct defaults', () => {
        const props = getDefaultHL7V3BatchProperties();
        expect(props.splitType).toBe(HL7V3SplitType.JavaScript);
        expect(props.batchScript).toBe('');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message', () => {
      const serializer = new HL7V3Serializer();
      const metadata = serializer.getMetaData('');
      expect(metadata.version).toBe('3.0');
      expect(metadata.type).toBe('');
    });

    it('should handle malformed XML gracefully', () => {
      const serializer = new HL7V3Serializer();
      const metadata = serializer.getMetaData('<unclosed>');
      // Implementation correctly extracts just the element name
      expect(metadata.type).toBe('unclosed');
    });

    it('should handle self-closing root element', () => {
      const serializer = new HL7V3Serializer();
      const metadata = serializer.getMetaData('<EmptyMessage/>');
      // Implementation correctly extracts just the element name without />
      expect(metadata.type).toBe('EmptyMessage');
    });

    it('should handle very long messages', () => {
      const longContent = '<data>' + 'x'.repeat(10000) + '</data>';
      const message = `<LongMessage>${longContent}</LongMessage>`;
      const serializer = new HL7V3Serializer();
      const metadata = serializer.getMetaData(message);
      expect(metadata.type).toBe('LongMessage');
    });

    it('should handle multiple namespace prefixes', () => {
      const xml = `<root xmlns:a="urn:a" xmlns:b="urn:b" xmlns:c="urn:c"><a:child/><b:child/></root>`;
      const result = stripHL7V3Namespaces(xml);
      expect(result).not.toContain('xmlns:a');
      expect(result).not.toContain('xmlns:b');
      expect(result).not.toContain('xmlns:c');
      // Prefixes on elements are NOT removed (matches Java behavior)
      expect(result).toContain('<a:child');
      expect(result).toContain('<b:child');
    });
  });
});
