import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { isDefaultScript } from '../../../src/artifact/types.js';
import type { ScriptSource, ExtractedScript, ScriptLocation, ScriptType } from '../types.js';

/**
 * Extract scripts from a Mirth Connect channel XML file.
 *
 * Handles the monolithic XML format that Java Mirth stores in the database.
 * Scripts are found in transformer steps (JavaScriptStep), filter rules
 * (JavaScriptRule), response transformers, and channel-level scripts
 * (preprocess, postprocess, deploy, undeploy).
 */
export class ChannelXmlSource implements ScriptSource {
  readonly sourceType = 'channel-xml' as const;
  readonly sourcePath: string;
  private xmlContent: string;

  constructor(filePathOrXml: string) {
    if (filePathOrXml.trimStart().startsWith('<')) {
      this.xmlContent = filePathOrXml;
      this.sourcePath = '<inline>';
    } else {
      this.sourcePath = filePathOrXml;
      this.xmlContent = fs.readFileSync(filePathOrXml, 'utf-8');
    }
  }

  extractScripts(): ExtractedScript[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      isArray: (_name) =>
        [
          'connector',
          'com.mirth.connect.plugins.javascriptstep.JavaScriptStep',
          'com.mirth.connect.plugins.javascriptrule.JavaScriptRule',
        ].includes(_name),
    });

    const parsed = parser.parse(this.xmlContent);
    const channel = parsed.channel;
    if (!channel) return [];

    const channelName = channel.name || 'Unknown';
    const channelId = channel.id || undefined;
    const scripts: ExtractedScript[] = [];

    // Extract source connector scripts
    const sourceConnector = channel.sourceConnector;
    if (sourceConnector) {
      const connectorName = sourceConnector.name || 'Source';
      this.extractTransformerSteps(scripts, sourceConnector.transformer, channelName, channelId, connectorName);
      this.extractFilterRules(scripts, sourceConnector.filter, channelName, channelId, connectorName);
    }

    // Extract destination connector scripts
    const destConnectors = channel.destinationConnectors;
    if (destConnectors) {
      const connectors = Array.isArray(destConnectors.connector)
        ? destConnectors.connector
        : destConnectors.connector
          ? [destConnectors.connector]
          : [];

      for (const connector of connectors) {
        const connectorName = connector.name || 'Destination';
        this.extractTransformerSteps(scripts, connector.transformer, channelName, channelId, connectorName);
        this.extractFilterRules(scripts, connector.filter, channelName, channelId, connectorName);
        this.extractTransformerSteps(
          scripts,
          connector.responseTransformer,
          channelName,
          channelId,
          connectorName,
          'response-transformer',
        );
      }
    }

    // Extract channel-level scripts
    this.addChannelScript(scripts, channel.preprocessingScript, 'preprocess', channelName, channelId);
    this.addChannelScript(scripts, channel.postprocessingScript, 'postprocess', channelName, channelId);
    this.addChannelScript(scripts, channel.deployScript, 'deploy', channelName, channelId);
    this.addChannelScript(scripts, channel.undeployScript, 'undeploy', channelName, channelId);

    return scripts;
  }

  private extractTransformerSteps(
    scripts: ExtractedScript[],
    transformer: Record<string, unknown> | undefined,
    channelName: string,
    channelId: string | undefined,
    connectorName: string,
    overrideType?: ScriptType,
  ): void {
    if (!transformer?.elements) return;
    const elements = transformer.elements as Record<string, unknown>;
    const steps =
      (elements['com.mirth.connect.plugins.javascriptstep.JavaScriptStep'] as Array<Record<string, unknown>>) || [];
    for (const step of steps) {
      const script = step.script as string | undefined;
      if (isDefaultScript(script)) continue;
      const scriptType: ScriptType = overrideType || 'transformer';
      const location: ScriptLocation = {
        channelName,
        channelId,
        connectorName,
        scriptType,
        filePath: this.sourcePath,
      };
      scripts.push({ location, content: script! });
    }
  }

  private extractFilterRules(
    scripts: ExtractedScript[],
    filter: Record<string, unknown> | undefined,
    channelName: string,
    channelId: string | undefined,
    connectorName: string,
  ): void {
    if (!filter?.elements) return;
    const elements = filter.elements as Record<string, unknown>;
    const rules =
      (elements['com.mirth.connect.plugins.javascriptrule.JavaScriptRule'] as Array<Record<string, unknown>>) || [];
    for (const rule of rules) {
      const script = rule.script as string | undefined;
      if (isDefaultScript(script)) continue;
      const location: ScriptLocation = {
        channelName,
        channelId,
        connectorName,
        scriptType: 'filter',
        filePath: this.sourcePath,
      };
      scripts.push({ location, content: script! });
    }
  }

  private addChannelScript(
    scripts: ExtractedScript[],
    script: string | undefined,
    scriptType: ScriptType,
    channelName: string,
    channelId: string | undefined,
  ): void {
    if (isDefaultScript(script)) return;
    const location: ScriptLocation = {
      channelName,
      channelId,
      scriptType,
      filePath: this.sourcePath,
    };
    scripts.push({ location, content: script! });
  }
}
