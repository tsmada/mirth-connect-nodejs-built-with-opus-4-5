/**
 * Maps git file changes to Mirth artifact IDs for selective deployment.
 *
 * Works entirely on file path strings (from `git diff --name-only`) —
 * no filesystem or git access required. This makes it trivially testable
 * and usable in both CLI and CI/CD contexts.
 */

// ─── Result Types ────────────────────────────────────────────────

export interface DeltaResult {
  changedChannels: ChannelChange[];
  changedCodeTemplates: CodeTemplateChange[];
  changedConfig: ConfigChange[];
  cascadedChannels: CascadedChannel[];
  totalAffected: number;
  summary: string;
}

export interface ChannelChange {
  channelName: string;
  channelId?: string;
  changeType: 'added' | 'modified' | 'deleted';
  changedFiles: string[];
  sections: string[];
}

export interface CodeTemplateChange {
  libraryName: string;
  templateName?: string;
  changeType: 'added' | 'modified' | 'deleted';
}

export interface ConfigChange {
  file: string;
  changeType: 'added' | 'modified' | 'deleted';
}

export interface CascadedChannel {
  channelName: string;
  channelId?: string;
  reason: string;
}

// ─── Options ─────────────────────────────────────────────────────

export interface DeltaOptions {
  includeCascades?: boolean;
  codeTemplateLibraries?: Array<{
    name: string;
    enabledChannelIds: string[];
  }>;
  /** Map of channel ID → channel name, for cascade resolution */
  channelIdToName?: Map<string, string>;
  /** All known channel names (for environment-change cascading) */
  allChannelNames?: string[];
}

// ─── Artifact Classification ─────────────────────────────────────

export type ArtifactType =
  | 'channel'
  | 'code_template'
  | 'group'
  | 'config'
  | 'environment'
  | 'unknown';

export interface ArtifactMapping {
  type: ArtifactType;
  name?: string;
  section?: string;
}

// ─── Path Segment Constants ──────────────────────────────────────

const CHANNELS_PREFIX = 'channels/';
const CODE_TEMPLATES_PREFIX = 'code-templates/';
const GROUPS_PREFIX = 'groups/';
const CONFIG_PREFIX = 'config/';
const ENVIRONMENTS_PREFIX = 'environments/';

// ─── DeltaDetector ───────────────────────────────────────────────

export class DeltaDetector {
  /**
   * Given a list of changed file paths (from git diff --name-only),
   * determine which Mirth artifacts are affected.
   */
  static detect(changedFiles: string[], options?: DeltaOptions): DeltaResult {
    const includeCascades = options?.includeCascades ?? true;

    // Accumulate changes per channel (dedup by name)
    const channelMap = new Map<string, { files: string[]; sections: Set<string> }>();
    const codeTemplateMap = new Map<
      string,
      { templateNames: Set<string>; libraryLevelChange: boolean }
    >();
    const configChanges: ConfigChange[] = [];
    let environmentChanged = false;

    for (const filePath of changedFiles) {
      const normalized = normalizePath(filePath);
      const mapping = DeltaDetector.mapFileToArtifact(normalized);

      switch (mapping.type) {
        case 'channel': {
          const name = mapping.name!;
          let entry = channelMap.get(name);
          if (!entry) {
            entry = { files: [], sections: new Set() };
            channelMap.set(name, entry);
          }
          entry.files.push(normalized);
          if (mapping.section) {
            entry.sections.add(mapping.section);
          }
          break;
        }
        case 'code_template': {
          const libName = mapping.name!;
          let entry = codeTemplateMap.get(libName);
          if (!entry) {
            entry = { templateNames: new Set(), libraryLevelChange: false };
            codeTemplateMap.set(libName, entry);
          }
          if (mapping.section) {
            entry.templateNames.add(mapping.section);
          } else {
            entry.libraryLevelChange = true;
          }
          break;
        }
        case 'config': {
          configChanges.push({
            file: normalized,
            changeType: 'modified',
          });
          break;
        }
        case 'environment': {
          environmentChanged = true;
          configChanges.push({
            file: normalized,
            changeType: 'modified',
          });
          break;
        }
        case 'group':
        case 'unknown':
          // Groups and unknown files don't trigger deployments
          break;
      }
    }

    // Build channel changes
    const changedChannels: ChannelChange[] = [];
    for (const [name, entry] of channelMap) {
      changedChannels.push({
        channelName: name,
        changeType: 'modified',
        changedFiles: entry.files,
        sections: Array.from(entry.sections).sort(),
      });
    }
    changedChannels.sort((a, b) => a.channelName.localeCompare(b.channelName));

    // Build code template changes
    const changedCodeTemplates: CodeTemplateChange[] = [];
    for (const [libName, entry] of codeTemplateMap) {
      // Emit a library-level entry if library.yaml changed
      if (entry.libraryLevelChange) {
        changedCodeTemplates.push({
          libraryName: libName,
          changeType: 'modified',
        });
      }
      // Emit per-template entries for individual template files
      for (const templateName of entry.templateNames) {
        changedCodeTemplates.push({
          libraryName: libName,
          templateName,
          changeType: 'modified',
        });
      }
    }
    changedCodeTemplates.sort((a, b) => {
      const cmp = a.libraryName.localeCompare(b.libraryName);
      if (cmp !== 0) return cmp;
      return (a.templateName ?? '').localeCompare(b.templateName ?? '');
    });

    // Determine cascades
    let cascadedChannels: CascadedChannel[] = [];
    if (includeCascades) {
      // Code template → channel cascades
      if (changedCodeTemplates.length > 0 && options?.codeTemplateLibraries) {
        cascadedChannels = DeltaDetector.findCascades(
          changedCodeTemplates,
          options.codeTemplateLibraries,
          options.channelIdToName
        );
      }

      // Environment change → all channels cascade
      if (environmentChanged && options?.allChannelNames) {
        const directlyChanged = new Set(changedChannels.map((c) => c.channelName));
        const alreadyCascaded = new Set(cascadedChannels.map((c) => c.channelName));
        for (const name of options.allChannelNames) {
          if (!directlyChanged.has(name) && !alreadyCascaded.has(name)) {
            cascadedChannels.push({
              channelName: name,
              reason: 'Environment config changed',
            });
          }
        }
      }
    }

    // Filter out cascaded channels that are already directly changed
    const directNames = new Set(changedChannels.map((c) => c.channelName));
    cascadedChannels = cascadedChannels.filter((c) => !directNames.has(c.channelName));
    cascadedChannels.sort((a, b) => a.channelName.localeCompare(b.channelName));

    const totalAffected = changedChannels.length + cascadedChannels.length;

    const summary = buildSummary(
      changedChannels,
      changedCodeTemplates,
      configChanges,
      cascadedChannels
    );

    return {
      changedChannels,
      changedCodeTemplates,
      changedConfig: configChanges,
      cascadedChannels,
      totalAffected,
      summary,
    };
  }

  /**
   * Map a single file path to its artifact type and identity.
   */
  static mapFileToArtifact(filePath: string): ArtifactMapping {
    const normalized = normalizePath(filePath);

    // channels/{channel-name}/...
    if (normalized.startsWith(CHANNELS_PREFIX)) {
      const rest = normalized.slice(CHANNELS_PREFIX.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) {
        // e.g. "channels/adt-receiver" (directory itself, unlikely but handle it)
        return { type: 'channel', name: rest || undefined };
      }
      const channelName = rest.slice(0, slashIdx);
      const subPath = rest.slice(slashIdx + 1);
      const section = classifyChannelSection(subPath);
      return { type: 'channel', name: channelName, section };
    }

    // code-templates/{library-name}/...
    if (normalized.startsWith(CODE_TEMPLATES_PREFIX)) {
      const rest = normalized.slice(CODE_TEMPLATES_PREFIX.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) {
        // e.g. "code-templates/util-lib" (directory itself)
        return { type: 'code_template', name: rest || undefined };
      }
      const libraryName = rest.slice(0, slashIdx);
      const fileName = rest.slice(slashIdx + 1);
      if (fileName === 'library.yaml') {
        return { type: 'code_template', name: libraryName };
      }
      // Template file — strip extension for template name
      const templateName = stripExtension(fileName);
      return { type: 'code_template', name: libraryName, section: templateName };
    }

    // groups/{group-name}.yaml
    if (normalized.startsWith(GROUPS_PREFIX)) {
      const rest = normalized.slice(GROUPS_PREFIX.length);
      const name = stripExtension(rest);
      return { type: 'group', name };
    }

    // config/...
    if (normalized.startsWith(CONFIG_PREFIX)) {
      return { type: 'config', name: normalized };
    }

    // environments/...
    if (normalized.startsWith(ENVIRONMENTS_PREFIX)) {
      return { type: 'environment', name: normalized };
    }

    return { type: 'unknown' };
  }

  /**
   * Determine dependency cascades from code template changes.
   *
   * When a code template library is modified, every channel that has that
   * library enabled needs to be redeployed — even if the channel's own
   * files haven't changed.
   */
  static findCascades(
    changedTemplates: CodeTemplateChange[],
    libraries: Array<{ name: string; enabledChannelIds: string[] }>,
    channelIdToName?: Map<string, string>
  ): CascadedChannel[] {
    const changedLibNames = new Set(changedTemplates.map((t) => t.libraryName));
    const cascaded: CascadedChannel[] = [];
    const seen = new Set<string>();

    for (const lib of libraries) {
      if (!changedLibNames.has(lib.name)) continue;

      for (const channelId of lib.enabledChannelIds) {
        if (seen.has(channelId)) continue;
        seen.add(channelId);

        const channelName = channelIdToName?.get(channelId) ?? channelId;
        cascaded.push({
          channelName,
          channelId,
          reason: `Uses modified code template library '${lib.name}'`,
        });
      }
    }

    return cascaded;
  }

  /**
   * Format delta result for CLI display.
   */
  static formatForCli(result: DeltaResult): string {
    const lines: string[] = [];

    // Header
    const parts: string[] = [];
    if (result.changedChannels.length > 0) {
      parts.push(
        `${result.changedChannels.length} channel${result.changedChannels.length === 1 ? '' : 's'} changed`
      );
    }
    if (result.cascadedChannels.length > 0) {
      parts.push(`${result.cascadedChannels.length} cascaded`);
    }
    if (result.changedCodeTemplates.length > 0) {
      parts.push(
        `${result.changedCodeTemplates.length} code template${result.changedCodeTemplates.length === 1 ? '' : 's'} changed`
      );
    }
    if (result.changedConfig.length > 0) {
      parts.push(
        `${result.changedConfig.length} config file${result.changedConfig.length === 1 ? '' : 's'} changed`
      );
    }
    if (parts.length === 0) {
      return 'Delta: No changes detected';
    }
    lines.push(`Delta: ${parts.join(', ')}`);

    // Changed channels
    if (result.changedChannels.length > 0) {
      lines.push('');
      lines.push('Changed:');
      for (const ch of result.changedChannels) {
        const prefix = changeTypeSymbol(ch.changeType);
        const detail = ch.sections.length > 0 ? ` (${ch.sections.join(', ')})` : '';
        lines.push(`  ${prefix} channels/${ch.channelName}/${detail}`);
      }
    }

    // Cascaded channels
    if (result.cascadedChannels.length > 0) {
      lines.push('');
      lines.push('Cascaded:');
      for (const ch of result.cascadedChannels) {
        lines.push(`  -> channels/${ch.channelName}/  (${ch.reason})`);
      }
    }

    // Config changes
    const configOnly = result.changedConfig.filter((c) => !c.file.startsWith(ENVIRONMENTS_PREFIX));
    if (configOnly.length > 0) {
      lines.push('');
      lines.push('Config:');
      for (const cfg of configOnly) {
        const prefix = changeTypeSymbol(cfg.changeType);
        lines.push(`  ${prefix} ${cfg.file}`);
      }
    }

    return lines.join('\n');
  }
}

// ─── Internal Helpers ────────────────────────────────────────────

function normalizePath(filePath: string): string {
  // Strip leading ./ or /
  let p = filePath.replace(/^\.\//, '').replace(/^\//, '');
  // Strip leading repo root prefix (e.g. "mirth-config/")
  // The canonical structure starts with channels/, code-templates/, etc.
  const knownPrefixes = [
    CHANNELS_PREFIX,
    CODE_TEMPLATES_PREFIX,
    GROUPS_PREFIX,
    CONFIG_PREFIX,
    ENVIRONMENTS_PREFIX,
  ];
  for (const prefix of knownPrefixes) {
    const idx = p.indexOf(prefix);
    if (idx > 0) {
      p = p.slice(idx);
      break;
    }
  }
  return p;
}

function classifyChannelSection(subPath: string): string {
  // source/... → "source"
  if (subPath.startsWith('source/') || subPath === 'source') {
    return 'source';
  }
  // destinations/{dest-name}/... → "destinations/{dest-name}"
  if (subPath.startsWith('destinations/')) {
    const rest = subPath.slice('destinations/'.length);
    const slashIdx = rest.indexOf('/');
    const destName = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    return `destinations/${destName}`;
  }
  // scripts/... → "scripts"
  if (subPath.startsWith('scripts/') || subPath === 'scripts') {
    return 'scripts';
  }
  // channel.yaml, _skeleton.xml → "config"
  return 'config';
}

function stripExtension(fileName: string): string {
  const dotIdx = fileName.lastIndexOf('.');
  return dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
}

function changeTypeSymbol(changeType: 'added' | 'modified' | 'deleted'): string {
  switch (changeType) {
    case 'added':
      return '+';
    case 'modified':
      return '~';
    case 'deleted':
      return '-';
  }
}

function buildSummary(
  channels: ChannelChange[],
  codeTemplates: CodeTemplateChange[],
  config: ConfigChange[],
  cascaded: CascadedChannel[]
): string {
  const parts: string[] = [];
  if (channels.length > 0) {
    parts.push(`${channels.length} channel${channels.length === 1 ? '' : 's'}`);
  }
  if (codeTemplates.length > 0) {
    parts.push(`${codeTemplates.length} code template${codeTemplates.length === 1 ? '' : 's'}`);
  }
  if (config.length > 0) {
    parts.push(`${config.length} config file${config.length === 1 ? '' : 's'}`);
  }
  if (cascaded.length > 0) {
    parts.push(`${cascaded.length} cascaded`);
  }
  if (parts.length === 0) return 'No changes';
  return parts.join(', ');
}
