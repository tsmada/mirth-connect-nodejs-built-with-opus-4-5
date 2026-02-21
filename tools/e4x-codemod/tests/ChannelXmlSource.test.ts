import * as path from 'path';
import { ChannelXmlSource } from '../sources/ChannelXmlSource.js';
import { ArtifactRepoSource } from '../sources/ArtifactRepoSource.js';

const FIXTURES = path.join(__dirname, 'fixtures');
const SAMPLE_CHANNEL = path.join(FIXTURES, 'sample-channel.xml');

describe('ChannelXmlSource', () => {
  it('extracts scripts from channel XML file', () => {
    const source = new ChannelXmlSource(SAMPLE_CHANNEL);
    const scripts = source.extractScripts();

    // Source transformer, source filter, dest transformer (no E4X but still extracted),
    // dest response transformer, preprocess, postprocess, deploy, undeploy
    expect(scripts.length).toBe(8);
  });

  it('extracts from inline XML string', () => {
    const xml = `<channel>
      <id>inline-001</id>
      <name>Inline Channel</name>
      <sourceConnector>
        <name>Source</name>
        <transformer>
          <elements>
            <com.mirth.connect.plugins.javascriptstep.JavaScriptStep>
              <name>Step1</name>
              <script>var x = msg..PID;</script>
            </com.mirth.connect.plugins.javascriptstep.JavaScriptStep>
          </elements>
        </transformer>
      </sourceConnector>
      <preprocessingScript>return message;</preprocessingScript>
      <postprocessingScript>return;</postprocessingScript>
      <deployScript>return;</deployScript>
      <undeployScript>return;</undeployScript>
    </channel>`;
    const source = new ChannelXmlSource(xml);
    expect(source.sourcePath).toBe('<inline>');
    const scripts = source.extractScripts();
    // Only the transformer step — all channel-level scripts are defaults
    expect(scripts.length).toBe(1);
    expect(scripts[0]!.content).toBe('var x = msg..PID;');
    expect(scripts[0]!.location.channelName).toBe('Inline Channel');
    expect(scripts[0]!.location.channelId).toBe('inline-001');
  });

  it('identifies correct script types', () => {
    const source = new ChannelXmlSource(SAMPLE_CHANNEL);
    const scripts = source.extractScripts();
    const types = scripts.map((s) => s.location.scriptType);
    expect(types).toContain('transformer');
    expect(types).toContain('filter');
    expect(types).toContain('response-transformer');
    expect(types).toContain('preprocess');
    expect(types).toContain('postprocess');
    expect(types).toContain('deploy');
    expect(types).toContain('undeploy');
  });

  it('populates channel name and connector names', () => {
    const source = new ChannelXmlSource(SAMPLE_CHANNEL);
    const scripts = source.extractScripts();

    // All scripts should have channel name
    for (const script of scripts) {
      expect(script.location.channelName).toBe('ADT Receiver');
      expect(script.location.channelId).toBe('test-channel-001');
    }

    // Source connector scripts
    const sourceScripts = scripts.filter((s) => s.location.connectorName === 'Source');
    expect(sourceScripts.length).toBe(2); // transformer + filter

    // Destination connector scripts
    const destScripts = scripts.filter((s) => s.location.connectorName === 'HTTP Sender');
    expect(destScripts.length).toBe(2); // transformer + response-transformer

    // Channel-level scripts have no connector name
    const channelScripts = scripts.filter((s) => !s.location.connectorName);
    expect(channelScripts.length).toBe(4); // preprocess, postprocess, deploy, undeploy
  });

  it('skips default scripts', () => {
    const xml = `<channel>
      <id>default-test</id>
      <name>Default Scripts Channel</name>
      <sourceConnector>
        <name>Source</name>
        <transformer><elements/></transformer>
      </sourceConnector>
      <preprocessingScript>return message;</preprocessingScript>
      <postprocessingScript>return;</postprocessingScript>
      <deployScript>// This script executes once when the channel is deployed
// You only have access to the globalMap and globalChannelMap here to persist data
return;</deployScript>
      <undeployScript>// This script executes once when the channel is undeployed
// You only have access to the globalMap and globalChannelMap here to persist data
return;</undeployScript>
    </channel>`;
    const source = new ChannelXmlSource(xml);
    const scripts = source.extractScripts();
    expect(scripts.length).toBe(0);
  });

  it('handles channels with no scripts', () => {
    const xml = `<channel>
      <id>empty-001</id>
      <name>Empty Channel</name>
      <sourceConnector>
        <name>Source</name>
      </sourceConnector>
      <preprocessingScript>return message;</preprocessingScript>
      <postprocessingScript>return;</postprocessingScript>
      <deployScript>return;</deployScript>
      <undeployScript>return;</undeployScript>
    </channel>`;
    const source = new ChannelXmlSource(xml);
    const scripts = source.extractScripts();
    expect(scripts.length).toBe(0);
  });

  it('handles multiple destinations', () => {
    const xml = `<channel>
      <id>multi-dest</id>
      <name>Multi Dest</name>
      <sourceConnector>
        <name>Source</name>
      </sourceConnector>
      <destinationConnectors>
        <connector>
          <name>Dest A</name>
          <transformer>
            <elements>
              <com.mirth.connect.plugins.javascriptstep.JavaScriptStep>
                <script>var x = 1;</script>
              </com.mirth.connect.plugins.javascriptstep.JavaScriptStep>
            </elements>
          </transformer>
        </connector>
        <connector>
          <name>Dest B</name>
          <transformer>
            <elements>
              <com.mirth.connect.plugins.javascriptstep.JavaScriptStep>
                <script>var y = 2;</script>
              </com.mirth.connect.plugins.javascriptstep.JavaScriptStep>
            </elements>
          </transformer>
          <filter>
            <elements>
              <com.mirth.connect.plugins.javascriptrule.JavaScriptRule>
                <script>return true;</script>
              </com.mirth.connect.plugins.javascriptrule.JavaScriptRule>
            </elements>
          </filter>
        </connector>
      </destinationConnectors>
      <preprocessingScript>return message;</preprocessingScript>
      <postprocessingScript>return;</postprocessingScript>
      <deployScript>return;</deployScript>
      <undeployScript>return;</undeployScript>
    </channel>`;
    const source = new ChannelXmlSource(xml);
    const scripts = source.extractScripts();

    expect(scripts.length).toBe(3); // Dest A transformer, Dest B transformer, Dest B filter
    expect(scripts[0]!.location.connectorName).toBe('Dest A');
    expect(scripts[1]!.location.connectorName).toBe('Dest B');
    expect(scripts[2]!.location.connectorName).toBe('Dest B');
    expect(scripts[2]!.location.scriptType).toBe('filter');
  });

  it('sets sourceType and sourcePath correctly', () => {
    const source = new ChannelXmlSource(SAMPLE_CHANNEL);
    expect(source.sourceType).toBe('channel-xml');
    expect(source.sourcePath).toBe(SAMPLE_CHANNEL);
  });

  it('extracts correct script content', () => {
    const source = new ChannelXmlSource(SAMPLE_CHANNEL);
    const scripts = source.extractScripts();
    const sourceTransformer = scripts.find(
      (s) => s.location.scriptType === 'transformer' && s.location.connectorName === 'Source',
    );
    expect(sourceTransformer).toBeDefined();
    expect(sourceTransformer!.content).toContain('msg..PID');
    expect(sourceTransformer!.content).toContain('msg.@version');
  });
});

describe('ArtifactRepoSource', () => {
  const ARTIFACT_REPO = path.join(FIXTURES, 'artifact-repo');

  it('walks artifact repo and extracts scripts', () => {
    const source = new ArtifactRepoSource(ARTIFACT_REPO);
    const scripts = source.extractScripts();

    // source/transformer.js (E4X), source/filter.js (no E4X but not default),
    // destinations/http-dest/transformer.js (E4X), scripts/deploy.js (not default — has "// Deploy script" prefix)
    expect(scripts.length).toBe(4);
  });

  it('reads channel metadata from channel.yaml', () => {
    const source = new ArtifactRepoSource(ARTIFACT_REPO);
    const scripts = source.extractScripts();

    for (const script of scripts) {
      expect(script.location.channelName).toBe('Test Channel');
      expect(script.location.channelId).toBe('test-channel-001');
    }
  });

  it('determines script type from filename', () => {
    const source = new ArtifactRepoSource(ARTIFACT_REPO);
    const scripts = source.extractScripts();
    const types = scripts.map((s) => s.location.scriptType);
    expect(types).toContain('transformer');
    expect(types).toContain('filter');
    expect(types).toContain('deploy');
  });

  it('populates connector name from directory', () => {
    const source = new ArtifactRepoSource(ARTIFACT_REPO);
    const scripts = source.extractScripts();

    const sourceScripts = scripts.filter((s) => s.location.connectorName === 'Source');
    expect(sourceScripts.length).toBe(2); // transformer + filter

    const destScripts = scripts.filter((s) => s.location.connectorName === 'http-dest');
    expect(destScripts.length).toBe(1); // transformer
  });

  it('sets sourceType and sourcePath correctly', () => {
    const source = new ArtifactRepoSource(ARTIFACT_REPO);
    expect(source.sourceType).toBe('artifact-repo');
    expect(source.sourcePath).toBe(ARTIFACT_REPO);
  });

  it('sets filePath to actual file on disk', () => {
    const source = new ArtifactRepoSource(ARTIFACT_REPO);
    const scripts = source.extractScripts();
    for (const script of scripts) {
      expect(script.location.filePath).toContain(ARTIFACT_REPO);
      expect(script.location.filePath).toMatch(/\.js$/);
    }
  });

  it('handles missing channels directory gracefully', () => {
    const source = new ArtifactRepoSource('/tmp/nonexistent-repo');
    const scripts = source.extractScripts();
    expect(scripts.length).toBe(0);
  });

  it('reads script content correctly', () => {
    const source = new ArtifactRepoSource(ARTIFACT_REPO);
    const scripts = source.extractScripts();
    const sourceTransformer = scripts.find(
      (s) => s.location.scriptType === 'transformer' && s.location.connectorName === 'Source',
    );
    expect(sourceTransformer).toBeDefined();
    expect(sourceTransformer!.content).toContain('msg..PID');
  });
});
