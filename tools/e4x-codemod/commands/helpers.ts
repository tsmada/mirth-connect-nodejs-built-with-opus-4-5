/**
 * Shared CLI helpers for resolving script sources from command options.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ChannelXmlSource } from '../sources/ChannelXmlSource.js';
import { ArtifactRepoSource } from '../sources/ArtifactRepoSource.js';
import type { ScriptSource } from '../types.js';

interface SourceOptions {
  channelXml?: string[];
  repo?: string;
}

/**
 * Resolve ScriptSource instances from CLI options.
 * Supports --channel-xml (one or more file paths/globs) and --repo (directory path).
 */
export function resolveSource(options: SourceOptions): ScriptSource[] {
  const sources: ScriptSource[] = [];

  if (options.channelXml && options.channelXml.length > 0) {
    for (const xmlPath of options.channelXml) {
      const resolved = path.resolve(xmlPath);
      if (!fs.existsSync(resolved)) {
        console.error(`Warning: File not found: ${resolved}`);
        continue;
      }
      sources.push(new ChannelXmlSource(resolved));
    }
  }

  if (options.repo) {
    const resolved = path.resolve(options.repo);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: Repository directory not found: ${resolved}`);
    } else {
      sources.push(new ArtifactRepoSource(resolved));
    }
  }

  return sources;
}
