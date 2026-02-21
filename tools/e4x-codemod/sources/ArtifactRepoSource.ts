import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { isDefaultScript } from '../../../src/artifact/types.js';
import type { ScriptSource, ExtractedScript, ScriptLocation, ScriptType } from '../types.js';

const SCRIPT_TYPE_MAP: Record<string, ScriptType> = {
  'filter.js': 'filter',
  'transformer.js': 'transformer',
  'response-transformer.js': 'response-transformer',
  'deploy.js': 'deploy',
  'undeploy.js': 'undeploy',
  'preprocess.js': 'preprocess',
  'postprocess.js': 'postprocess',
};

interface ChannelMetadata {
  id?: string;
  name?: string;
}

/**
 * Walk a decomposed artifact repo directory and extract scripts.
 *
 * Handles the git-friendly file tree format produced by ChannelDecomposer:
 * channels/{name}/source/*.js, channels/{name}/destinations/{dest}/*.js,
 * channels/{name}/scripts/*.js, and code-templates/{lib}/{template}.js.
 */
export class ArtifactRepoSource implements ScriptSource {
  readonly sourceType = 'artifact-repo' as const;
  readonly sourcePath: string;

  constructor(repoPath: string) {
    this.sourcePath = repoPath;
  }

  extractScripts(): ExtractedScript[] {
    const scripts: ExtractedScript[] = [];

    // Walk channels/
    const channelsDir = path.join(this.sourcePath, 'channels');
    if (fs.existsSync(channelsDir)) {
      for (const channelDir of this.listDirs(channelsDir)) {
        const channelPath = path.join(channelsDir, channelDir);
        const metadata = this.readChannelMetadata(channelPath);
        const channelName = metadata.name || channelDir;
        const channelId = metadata.id;

        // source/
        this.extractConnectorScripts(scripts, path.join(channelPath, 'source'), channelName, channelId, 'Source');

        // destinations/{dest-name}/
        const destsDir = path.join(channelPath, 'destinations');
        if (fs.existsSync(destsDir)) {
          for (const destDir of this.listDirs(destsDir)) {
            this.extractConnectorScripts(scripts, path.join(destsDir, destDir), channelName, channelId, destDir);
          }
        }

        // scripts/
        const scriptsDir = path.join(channelPath, 'scripts');
        if (fs.existsSync(scriptsDir)) {
          this.extractChannelScripts(scripts, scriptsDir, channelName, channelId);
        }
      }
    }

    // Walk code-templates/
    const templatesDir = path.join(this.sourcePath, 'code-templates');
    if (fs.existsSync(templatesDir)) {
      for (const libraryDir of this.listDirs(templatesDir)) {
        const libraryPath = path.join(templatesDir, libraryDir);
        for (const file of this.listFiles(libraryPath)) {
          if (!file.endsWith('.js')) continue;
          const filePath = path.join(libraryPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          if (isDefaultScript(content)) continue;
          const location: ScriptLocation = {
            channelName: libraryDir,
            scriptType: 'code-template',
            filePath,
          };
          scripts.push({ location, content });
        }
      }
    }

    return scripts;
  }

  private extractConnectorScripts(
    scripts: ExtractedScript[],
    dirPath: string,
    channelName: string,
    channelId: string | undefined,
    connectorName: string,
  ): void {
    if (!fs.existsSync(dirPath)) return;
    for (const file of this.listFiles(dirPath)) {
      const scriptType = SCRIPT_TYPE_MAP[file];
      if (!scriptType) continue;
      const filePath = path.join(dirPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (isDefaultScript(content)) continue;
      const location: ScriptLocation = {
        channelName,
        channelId,
        connectorName,
        scriptType,
        filePath,
      };
      scripts.push({ location, content });
    }
  }

  private extractChannelScripts(
    scripts: ExtractedScript[],
    scriptsDir: string,
    channelName: string,
    channelId: string | undefined,
  ): void {
    for (const file of this.listFiles(scriptsDir)) {
      const scriptType = SCRIPT_TYPE_MAP[file];
      if (!scriptType) continue;
      const filePath = path.join(scriptsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (isDefaultScript(content)) continue;
      const location: ScriptLocation = {
        channelName,
        channelId,
        scriptType,
        filePath,
      };
      scripts.push({ location, content });
    }
  }

  private readChannelMetadata(channelDir: string): ChannelMetadata {
    const yamlPath = path.join(channelDir, 'channel.yaml');
    if (!fs.existsSync(yamlPath)) return {};
    const content = fs.readFileSync(yamlPath, 'utf-8');
    return (yaml.load(content) as ChannelMetadata) || {};
  }

  private listDirs(dirPath: string): string[] {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  }

  private listFiles(dirPath: string): string[] {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort();
  }
}
