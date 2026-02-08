import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { decompose } from '../../../src/artifact/ChannelDecomposer.js';
import { assemble } from '../../../src/artifact/ChannelAssembler.js';

const FIXTURES_DIR = path.join(__dirname, '../../fixtures/artifact');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: false,
    processEntities: false,
    isArray: (name: string) => {
      return ['connector', 'entry', 'string', 'rule', 'metaDataColumn', 'channelTag'].includes(name);
    },
  });
}

function stripWhitespaceText(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(stripWhitespaceText);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key === '#text' && typeof value === 'string' && value.trim() === '') {
        continue;
      }
      result[key] = stripWhitespaceText(value);
    }
    return result;
  }
  return obj;
}

describe('ChannelAssembler', () => {
  const parser = createParser();

  describe('Basic assembly', () => {
    it('should produce valid XML output', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);

      expect(assembled).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(assembled).toContain('<channel');
      expect(assembled).toContain('</channel>');
    });

    it('should preserve channel ID', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      expect(parsed.channel.id).toBe('77500001-0001-0001-0001-000000000001');
    });

    it('should preserve channel version attribute', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      expect(parsed.channel['@_version']).toBe('3.9.1');
    });
  });

  describe('Metadata modification', () => {
    it('should apply modified metadata fields', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);

      // Modify metadata
      decomposed.metadata.name = 'Modified Channel Name';
      decomposed.metadata.revision = 42;
      decomposed.metadata.description = 'Updated description';

      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      expect(parsed.channel.name).toBe('Modified Channel Name');
      expect(parsed.channel.revision).toBe('42');
      expect(parsed.channel.description).toBe('Updated description');
    });
  });

  describe('Script injection', () => {
    it('should inject modified channel scripts', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);

      decomposed.scripts.deploy = '// Modified deploy script\nlogger.info("deployed");\nreturn;';

      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      expect(parsed.channel.deployScript).toContain('Modified deploy script');
    });

    it('should preserve all four channel script slots', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      expect(parsed.channel.deployScript).toBeDefined();
      expect(parsed.channel.undeployScript).toBeDefined();
      expect(parsed.channel.preprocessingScript).toBeDefined();
      expect(parsed.channel.postprocessingScript).toBeDefined();
    });
  });

  describe('Connector property injection', () => {
    it('should preserve source connector properties class attribute', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      expect(parsed.channel.sourceConnector.properties['@_class']).toBe(
        'com.mirth.connect.connectors.tcp.TcpReceiverProperties'
      );
    });

    it('should inject modified connector property values', () => {
      const xml = readFixture('sftp-orm-to-oru-channel.xml');
      const decomposed = decompose(xml);

      // Modify a property
      decomposed.source.properties.timeout = '30000';

      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      expect(parsed.channel.sourceConnector.properties.timeout).toBe('30000');
    });
  });

  describe('Transformer step injection', () => {
    it('should inject modified transformer step scripts', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);

      // Modify a step script
      decomposed.source.transformer!.steps[0]!.script = '// Modified script\nlogger.info("changed");';

      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      const step = parsed.channel.sourceConnector.transformer.elements[
        'com.mirth.connect.plugins.javascriptstep.JavaScriptStep'
      ];
      expect(step.script).toContain('Modified script');
    });
  });

  describe('Destination injection', () => {
    it('should preserve all destinations', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      const connectors = parsed.channel.destinationConnectors.connector;
      expect(Array.isArray(connectors)).toBe(true);
      expect(connectors).toHaveLength(3);
    });

    it('should preserve destination order', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      const connectors = parsed.channel.destinationConnectors.connector;
      expect(connectors[0].name).toBe('Dest1 - Read Source, Add Value');
      expect(connectors[1].name).toBe('Dest2 - Read Both, Add Value');
      expect(connectors[2].name).toBe('Dest3 - Aggregate All');
    });

    it('should preserve destination transport names', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);
      const parsed = parser.parse(assembled);

      const connectors = parsed.channel.destinationConnectors.connector;
      for (const conn of connectors) {
        expect(conn.transportName).toBe('Channel Writer');
      }
    });
  });

  describe('Variable resolution', () => {
    it('should resolve ${VAR} references in connector properties', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);

      // Inject a variable reference into source properties
      const props = decomposed.source.properties as Record<string, unknown>;
      const listenerProps = props.listenerConnectorProperties as Record<string, unknown>;
      listenerProps.port = '${MLLP_PORT}';

      const assembled = assemble(decomposed, {
        variables: { MLLP_PORT: '7771' },
      });
      const parsed = parser.parse(assembled);

      const port = parsed.channel.sourceConnector.properties
        .listenerConnectorProperties.port;
      expect(port).toBe('7771');
    });

    it('should resolve ${VAR:default} with fallback', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);

      // Inject a variable with default
      const props = decomposed.source.properties as Record<string, unknown>;
      const listenerProps = props.listenerConnectorProperties as Record<string, unknown>;
      listenerProps.port = '${MLLP_PORT:6662}';

      // No variable provided — should use default
      const assembled = assemble(decomposed, { variables: {} });
      const parsed = parser.parse(assembled);

      const port = parsed.channel.sourceConnector.properties
        .listenerConnectorProperties.port;
      expect(port).toBe('6662');
    });

    it('should leave unresolved variables intact when no match', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);

      const props = decomposed.source.properties as Record<string, unknown>;
      const listenerProps = props.listenerConnectorProperties as Record<string, unknown>;
      listenerProps.port = '${UNKNOWN_VAR}';

      const assembled = assemble(decomposed, { variables: {} });
      const parsed = parser.parse(assembled);

      const port = parsed.channel.sourceConnector.properties
        .listenerConnectorProperties.port;
      expect(port).toBe('${UNKNOWN_VAR}');
    });
  });

  describe('Export data and properties preservation', () => {
    it('should preserve exportData section', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);

      const originalParsed = parser.parse(xml);
      const assembledParsed = parser.parse(assembled);

      // Strip whitespace text nodes from comparison (XMLBuilder reformats indentation)
      expect(stripWhitespaceText(assembledParsed.channel.exportData))
        .toEqual(stripWhitespaceText(originalParsed.channel.exportData));
    });

    it('should preserve channel properties section', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);

      const originalParsed = parser.parse(xml);
      const assembledParsed = parser.parse(assembled);

      expect(stripWhitespaceText(assembledParsed.channel.properties))
        .toEqual(stripWhitespaceText(originalParsed.channel.properties));
    });
  });

  describe('Edge cases', () => {
    it('should handle assembly without options', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);

      expect(assembled).toContain('<channel');
      expect(parser.parse(assembled).channel.id).toBe('77500001-0001-0001-0001-000000000001');
    });

    it('should handle channel with SFTP connector properties', () => {
      const xml = readFixture('sftp-orm-to-oru-channel.xml');
      const decomposed = decompose(xml);
      const assembled = assemble(decomposed);

      const originalParsed = parser.parse(xml);
      const assembledParsed = parser.parse(assembled);

      expect(stripWhitespaceText(assembledParsed))
        .toEqual(stripWhitespaceText(originalParsed));
    });
  });
});
