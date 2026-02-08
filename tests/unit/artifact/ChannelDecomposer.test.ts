import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { decompose, toFileTree } from '../../../src/artifact/ChannelDecomposer.js';
import { assemble } from '../../../src/artifact/ChannelAssembler.js';
import { sanitizeName, isDefaultScript } from '../../../src/artifact/types.js';

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

/**
 * Strip #text whitespace-only nodes that are an artifact of XML formatting.
 * XMLBuilder produces different indentation than the original, causing
 * #text nodes to differ even though the semantic content is identical.
 */
function stripWhitespaceText(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(stripWhitespaceText);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Skip #text keys that are whitespace-only
      if (key === '#text' && typeof value === 'string' && value.trim() === '') {
        continue;
      }
      result[key] = stripWhitespaceText(value);
    }
    return result;
  }
  return obj;
}

describe('ChannelDecomposer', () => {
  describe('Metadata extraction', () => {
    it('should extract channel ID, name, version, revision', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.metadata.id).toBe('77500001-0001-0001-0001-000000000001');
      expect(result.metadata.name).toBe('Full Lifecycle Script Test');
      expect(result.metadata.version).toBe('3.9.1');
      expect(result.metadata.revision).toBe(1);
      expect(result.metadata.enabled).toBe(true);
    });

    it('should extract description when present', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.metadata.description).toBe(
        'Tests all scripts run in correct order: deploy -> pre -> post -> undeploy'
      );
    });

    it('should extract nextMetaDataId', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.metadata.nextMetaDataId).toBe(2);
    });

    it('should handle channel with different version', () => {
      const xml = readFixture('sftp-orm-to-oru-channel.xml');
      const result = decompose(xml);

      expect(result.metadata.version).toBe('3.8.0');
      expect(result.metadata.name).toBe('SFTP ORM to ORU Lab Transform');
    });
  });

  describe('Source connector extraction', () => {
    it('should extract source connector name and transport', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.source.name).toBe('sourceConnector');
      expect(result.source.transportName).toBe('TCP Listener');
      expect(result.source.mode).toBe('SOURCE');
      expect(result.source.metaDataId).toBe(0);
    });

    it('should extract source connector properties class', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.source.propertiesClass).toBe(
        'com.mirth.connect.connectors.tcp.TcpReceiverProperties'
      );
    });

    it('should extract source connector properties without class/version attrs', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      // Properties should NOT contain @_ prefixed attributes
      expect(result.source.properties['@_class']).toBeUndefined();
      expect(result.source.properties['@_version']).toBeUndefined();

      // But should contain actual properties
      expect(result.source.properties.serverMode).toBeDefined();
    });

    it('should extract source transformer steps', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.source.transformer).toBeDefined();
      expect(result.source.transformer!.steps).toHaveLength(1);

      const step = result.source.transformer!.steps[0]!;
      expect(step.name).toBe('Add Transformer to Log');
      expect(step.sequenceNumber).toBe(0);
      expect(step.enabled).toBe(true);
      expect(step.type).toBe(
        'com.mirth.connect.plugins.javascriptstep.JavaScriptStep'
      );
      expect(step.script).toContain("$gc('executionLog'");
    });

    it('should extract transformer data types', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.source.transformer!.inboundDataType).toBe('HL7V2');
      expect(result.source.transformer!.outboundDataType).toBe('HL7V2');
      expect(result.source.transformer!.inboundProperties).toBeDefined();
      expect(result.source.transformer!.inboundPropertiesClass).toBe(
        'com.mirth.connect.plugins.datatypes.hl7v2.HL7v2DataTypeProperties'
      );
    });
  });

  describe('Destination connector extraction', () => {
    it('should extract single destination', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.destinations.size).toBe(1);
      const [name, dest] = Array.from(result.destinations.entries())[0]!;
      expect(name).toBe('sink');
      expect(dest.transportName).toBe('Channel Writer');
      expect(dest.metaDataId).toBe(1);
    });

    it('should extract multiple destinations', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const result = decompose(xml);

      expect(result.destinations.size).toBe(3);
      const destNames = Array.from(result.destinations.keys());
      expect(destNames).toContain('dest1-read-source-add-value');
      expect(destNames).toContain('dest2-read-both-add-value');
      expect(destNames).toContain('dest3-aggregate-all');
    });

    it('should extract destination transformer scripts', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const result = decompose(xml);

      const dest1 = result.destinations.get('dest1-read-source-add-value');
      expect(dest1).toBeDefined();
      expect(dest1!.transformer!.steps).toHaveLength(1);
      expect(dest1!.transformer!.steps[0]!.name).toBe('Dest1 Transformer');
      expect(dest1!.transformer!.steps[0]!.script).toContain("$c('dest1Value', 'fromDest1')");
    });

    it('should extract destination with empty transformer elements', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const result = decompose(xml);

      const dest1 = result.destinations.get('dest1-read-source-add-value');
      expect(dest1).toBeDefined();
      // Response transformer should have empty steps
      expect(dest1!.responseTransformer).toBeDefined();
      expect(dest1!.responseTransformer!.steps).toHaveLength(0);
    });
  });

  describe('Channel scripts extraction', () => {
    it('should extract non-default channel scripts', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const result = decompose(xml);

      expect(result.scripts.deploy).toContain("$gc('executionLog', 'deploy')");
      expect(result.scripts.undeploy).toContain("$g('finalExecutionLog'");
      expect(result.scripts.preprocess).toContain("log + ',preprocessor'");
      expect(result.scripts.postprocess).toContain("log + ',postprocessor'");
    });

    it('should extract default scripts as-is (filtering happens at file tree level)', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const result = decompose(xml);

      // These are default scripts: "return message;" and "return;"
      expect(result.scripts.preprocess).toBe('return message;');
      expect(result.scripts.postprocess).toBe('return;');
      expect(result.scripts.deploy).toBe('return;');
      expect(result.scripts.undeploy).toBe('return;');
    });
  });

  describe('File tree generation', () => {
    it('should produce channel.yaml', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const files = toFileTree(decomposed);

      const channelYaml = files.find(f => f.path === 'channel.yaml');
      expect(channelYaml).toBeDefined();
      expect(channelYaml!.type).toBe('yaml');
      expect(channelYaml!.content).toContain('id: 77500001-0001-0001-0001-000000000001');
      expect(channelYaml!.content).toContain('name: Full Lifecycle Script Test');
    });

    it('should produce source connector.yaml', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const files = toFileTree(decomposed);

      const connYaml = files.find(f => f.path === 'source/connector.yaml');
      expect(connYaml).toBeDefined();
      expect(connYaml!.type).toBe('yaml');
      expect(connYaml!.content).toContain('transportName: TCP Listener');
    });

    it('should produce transformer step script files with metadata headers', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const files = toFileTree(decomposed);

      const stepFiles = files.filter(f => f.path.includes('transformer/step-'));
      expect(stepFiles.length).toBeGreaterThan(0);

      const step = stepFiles[0]!;
      expect(step.type).toBe('js');
      expect(step.content).toContain('// @mirth-artifact');
      expect(step.content).toContain('// @name Add Transformer to Log');
      expect(step.content).toContain('// @sequence 0');
      expect(step.content).toContain('// @enabled true');
      expect(step.content).toContain('// @type com.mirth.connect.plugins.javascriptstep.JavaScriptStep');
    });

    it('should produce channel script files for non-default scripts', () => {
      const xml = readFixture('full-lifecycle-channel.xml');
      const decomposed = decompose(xml);
      const files = toFileTree(decomposed);

      const scriptFiles = files.filter(f => f.path.startsWith('scripts/'));
      expect(scriptFiles.length).toBe(4);
      expect(scriptFiles.map(f => f.path)).toContain('scripts/deploy.js');
      expect(scriptFiles.map(f => f.path)).toContain('scripts/undeploy.js');
      expect(scriptFiles.map(f => f.path)).toContain('scripts/preprocess.js');
      expect(scriptFiles.map(f => f.path)).toContain('scripts/postprocess.js');
    });

    it('should NOT produce script files for default scripts', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const decomposed = decompose(xml);
      const files = toFileTree(decomposed);

      const scriptFiles = files.filter(f => f.path.startsWith('scripts/'));
      expect(scriptFiles.length).toBe(0);
    });

    it('should produce destination directories', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const decomposed = decompose(xml);
      const files = toFileTree(decomposed);

      const destFiles = files.filter(f => f.path.startsWith('destinations/'));
      // 3 destinations x (connector.yaml + transformer.yaml + step file)
      expect(destFiles.length).toBeGreaterThanOrEqual(3);

      const dest1Files = destFiles.filter(f =>
        f.path.startsWith('destinations/dest1-read-source-add-value/')
      );
      expect(dest1Files.some(f => f.path.endsWith('connector.yaml'))).toBe(true);
    });
  });

  describe('Round-trip fidelity', () => {
    const fixtures = [
      'full-lifecycle-channel.xml',
      'multi-destination-channel.xml',
      'sftp-orm-to-oru-channel.xml',
    ];

    const parser = createParser();

    fixtures.forEach(fixture => {
      it(`should round-trip ${fixture} without data loss`, () => {
        const originalXml = readFixture(fixture);
        const decomposed = decompose(originalXml);
        const reassembled = assemble(decomposed);

        // Parse both into objects for semantic comparison
        const originalParsed = parser.parse(originalXml);
        const reassembledParsed = parser.parse(reassembled);

        // Strip whitespace-only #text nodes before comparison.
        // XMLBuilder reformats indentation, so these differ cosmetically
        // but the semantic content is identical.
        const originalClean = stripWhitespaceText(originalParsed);
        const reassembledClean = stripWhitespaceText(reassembledParsed);

        expect(reassembledClean).toEqual(originalClean);
      });
    });
  });

  describe('Edge cases', () => {
    it('should throw on invalid XML (no channel root)', () => {
      expect(() => decompose('<invalid>not a channel</invalid>')).toThrow(/no <channel> root element/);
    });

    it('should handle channel with no destinations', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<channel version="3.9.1">
  <id>test-id</id>
  <name>No Dest Channel</name>
  <revision>1</revision>
  <sourceConnector version="3.9.1">
    <metaDataId>0</metaDataId>
    <name>sourceConnector</name>
    <properties class="com.mirth.connect.connectors.tcp.TcpReceiverProperties" version="3.9.1">
      <serverMode>true</serverMode>
    </properties>
    <transformer version="3.9.1">
      <elements/>
    </transformer>
    <filter version="3.9.1">
      <elements/>
    </filter>
    <transportName>TCP Listener</transportName>
    <mode>SOURCE</mode>
    <enabled>true</enabled>
  </sourceConnector>
  <preprocessingScript>return message;</preprocessingScript>
  <postprocessingScript>return;</postprocessingScript>
  <deployScript>return;</deployScript>
  <undeployScript>return;</undeployScript>
  <properties version="3.9.1">
    <clearGlobalChannelMap>true</clearGlobalChannelMap>
  </properties>
</channel>`;

      const result = decompose(xml);
      expect(result.destinations.size).toBe(0);
      expect(result.metadata.name).toBe('No Dest Channel');
    });

    it('should handle empty transformer elements', () => {
      const xml = readFixture('multi-destination-channel.xml');
      const result = decompose(xml);

      // Source filter should have empty rules
      expect(result.source.filter).toBeDefined();
      expect(result.source.filter!.rules).toHaveLength(0);
    });
  });
});

describe('sanitizeName', () => {
  it('should lowercase and replace spaces with hyphens', () => {
    expect(sanitizeName('Dest 1 - Send HTTP')).toBe('dest-1-send-http');
  });

  it('should remove special characters', () => {
    expect(sanitizeName('My Channel (v2.0)')).toBe('my-channel-v2-0');
  });

  it('should strip leading/trailing hyphens', () => {
    expect(sanitizeName('  --Test--  ')).toBe('test');
  });
});

describe('isDefaultScript', () => {
  it('should recognize empty string as default', () => {
    expect(isDefaultScript('')).toBe(true);
  });

  it('should recognize "return message;" as default', () => {
    expect(isDefaultScript('return message;')).toBe(true);
  });

  it('should recognize "return;" as default', () => {
    expect(isDefaultScript('return;')).toBe(true);
  });

  it('should NOT flag non-default scripts', () => {
    expect(isDefaultScript('logger.info("hello"); return;')).toBe(false);
  });

  it('should handle undefined', () => {
    expect(isDefaultScript(undefined)).toBe(true);
  });
});
