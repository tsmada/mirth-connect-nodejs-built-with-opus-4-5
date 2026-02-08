/**
 * Structural diff engine for decomposed Mirth channel representations.
 *
 * Ported concept: No Java equivalent — this is a Node.js-only feature for
 * git-backed artifact management. Produces human-readable comparisons at
 * two levels:
 *   1. Config diff: deep object comparison with dot-path change reporting
 *   2. Script diff: standard unified diff format for JavaScript files
 *
 * The unified diff implementation uses a classic LCS (Longest Common
 * Subsequence) algorithm to produce output matching `diff -u` format.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffResult {
  channelName: string;
  changeCount: number;
  configChanges: ConfigChange[];
  scriptChanges: ScriptChange[];
  summary: string;
}

export interface ConfigChange {
  path: string;
  type: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ScriptChange {
  path: string;
  type: 'added' | 'removed' | 'changed';
  unifiedDiff?: string;
  oldContent?: string;
  newContent?: string;
}

export interface DecomposedChannelFlat {
  metadata: Record<string, unknown>;
  scripts: Record<string, string>;
  sourceConnector: Record<string, unknown>;
  sourceScripts: Record<string, string>;
  destinations: Record<string, {
    connector: Record<string, unknown>;
    scripts: Record<string, string>;
  }>;
}

export interface DiffOptions {
  contextLines?: number;
  ignoreWhitespace?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function valuesEqual(a: unknown, b: unknown, ignoreWs: boolean): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;

  if (typeof a === 'string' && typeof b === 'string' && ignoreWs) {
    return normalizeWhitespace(a) === normalizeWhitespace(b);
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((el, i) => valuesEqual(el, b[i], ignoreWs));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => valuesEqual(a[k], b[k], ignoreWs));
  }

  return false;
}

// ---------------------------------------------------------------------------
// LCS-based unified diff
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNo: number;  // 1-based, 0 if N/A
  newLineNo: number;  // 1-based, 0 if N/A
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/**
 * Compute LCS table indices for two string arrays.
 * Returns a 2D table where table[i][j] = length of LCS of a[0..i-1] and b[0..j-1].
 */
function lcsTable(a: string[], b: string[], ignoreWs: boolean): number[][] {
  const m = a.length;
  const n = b.length;
  const table: number[][] = [];
  for (let i = 0; i <= m; i++) {
    table.push(new Array<number>(n + 1).fill(0));
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const aLine = a[i - 1]!;
      const bLine = b[j - 1]!;
      const match = ignoreWs
        ? normalizeWhitespace(aLine) === normalizeWhitespace(bLine)
        : aLine === bLine;
      if (match) {
        table[i]![j] = table[i - 1]![j - 1]! + 1;
      } else {
        table[i]![j] = Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
      }
    }
  }
  return table;
}

/**
 * Backtrack through the LCS table to produce a sequence of diff lines.
 */
function buildDiffLines(
  a: string[],
  b: string[],
  table: number[][],
  ignoreWs: boolean
): DiffLine[] {
  const result: DiffLine[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const aLine = a[i - 1]!;
      const bLine = b[j - 1]!;
      const match = ignoreWs
        ? normalizeWhitespace(aLine) === normalizeWhitespace(bLine)
        : aLine === bLine;
      if (match) {
        result.push({ type: 'context', content: aLine, oldLineNo: i, newLineNo: j });
        i--;
        j--;
        continue;
      }
    }

    if (j > 0 && (i === 0 || table[i]![j - 1]! >= table[i - 1]![j]!)) {
      result.push({ type: 'add', content: b[j - 1]!, oldLineNo: 0, newLineNo: j });
      j--;
    } else if (i > 0) {
      result.push({ type: 'remove', content: a[i - 1]!, oldLineNo: i, newLineNo: 0 });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Group diff lines into hunks with the specified number of context lines.
 */
function buildHunks(lines: DiffLine[], contextLines: number): Hunk[] {
  // Find ranges of change (non-context) lines
  const changeIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.type !== 'context') {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // Group change indices into clusters separated by more than 2*context lines
  const clusters: number[][] = [];
  let current: number[] = [changeIndices[0]!];

  for (let k = 1; k < changeIndices.length; k++) {
    const idx = changeIndices[k]!;
    const prevIdx = current[current.length - 1]!;
    // If the gap between changes is small enough, merge into one hunk
    if (idx - prevIdx <= 2 * contextLines + 1) {
      current.push(idx);
    } else {
      clusters.push(current);
      current = [idx];
    }
  }
  clusters.push(current);

  // Build hunks from clusters
  const hunks: Hunk[] = [];
  for (const cluster of clusters) {
    const firstChange = cluster[0]!;
    const lastChange = cluster[cluster.length - 1]!;

    const hunkStart = Math.max(0, firstChange - contextLines);
    const hunkEnd = Math.min(lines.length - 1, lastChange + contextLines);

    const hunkLines = lines.slice(hunkStart, hunkEnd + 1);

    // Compute old/new start line numbers and counts
    let oldStart = 0;
    let oldCount = 0;
    let newStart = 0;
    let newCount = 0;

    for (const line of hunkLines) {
      if (line.type === 'context' || line.type === 'remove') {
        if (oldStart === 0) oldStart = line.oldLineNo;
        oldCount++;
      }
      if (line.type === 'context' || line.type === 'add') {
        if (newStart === 0) newStart = line.newLineNo;
        newCount++;
      }
    }

    // Edge case: all additions (no old lines)
    if (oldStart === 0) oldStart = 1;
    if (newStart === 0) newStart = 1;

    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }

  return hunks;
}

function formatHunk(hunk: Hunk): string {
  const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
  const body = hunk.lines.map(line => {
    switch (line.type) {
      case 'add': return `+${line.content}`;
      case 'remove': return `-${line.content}`;
      case 'context': return ` ${line.content}`;
    }
  });
  return [header, ...body].join('\n');
}

// ---------------------------------------------------------------------------
// ChannelDiff
// ---------------------------------------------------------------------------

export class ChannelDiff {
  /**
   * Compare two decomposed channel representations.
   */
  static diff(
    oldChannel: DecomposedChannelFlat,
    newChannel: DecomposedChannelFlat,
    options?: DiffOptions
  ): DiffResult {
    const ctx = options?.contextLines ?? 3;
    const ignoreWs = options?.ignoreWhitespace ?? false;
    const channelName =
      (newChannel.metadata['name'] as string | undefined) ??
      (oldChannel.metadata['name'] as string | undefined) ??
      'Unknown Channel';

    const configChanges: ConfigChange[] = [];
    const scriptChanges: ScriptChange[] = [];

    // 1. Diff metadata
    configChanges.push(
      ...ChannelDiff.diffObjects(oldChannel.metadata, newChannel.metadata, 'metadata', ignoreWs)
    );

    // 2. Diff source connector config
    configChanges.push(
      ...ChannelDiff.diffObjects(
        oldChannel.sourceConnector,
        newChannel.sourceConnector,
        'source.connector',
        ignoreWs
      )
    );

    // 3. Diff source scripts
    ChannelDiff.diffScriptMaps(
      oldChannel.sourceScripts,
      newChannel.sourceScripts,
      'source',
      ctx,
      ignoreWs,
      scriptChanges
    );

    // 4. Diff channel-level scripts
    ChannelDiff.diffScriptMaps(
      oldChannel.scripts,
      newChannel.scripts,
      'scripts',
      ctx,
      ignoreWs,
      scriptChanges
    );

    // 5. Diff destinations
    const allDestKeys = new Set([
      ...Object.keys(oldChannel.destinations),
      ...Object.keys(newChannel.destinations),
    ]);

    for (const destKey of allDestKeys) {
      const oldDest = oldChannel.destinations[destKey];
      const newDest = newChannel.destinations[destKey];

      if (!oldDest && newDest) {
        // Entire destination added
        configChanges.push({
          path: `destinations.${destKey}`,
          type: 'added',
          newValue: newDest.connector,
        });
        for (const [name, content] of Object.entries(newDest.scripts)) {
          scriptChanges.push({
            path: `destinations/${destKey}/${name}`,
            type: 'added',
            newContent: content,
            unifiedDiff: ChannelDiff.unifiedDiff('', content, {
              context: ctx,
              header: `destinations/${destKey}/${name}`,
            }),
          });
        }
      } else if (oldDest && !newDest) {
        // Entire destination removed
        configChanges.push({
          path: `destinations.${destKey}`,
          type: 'removed',
          oldValue: oldDest.connector,
        });
        for (const [name, content] of Object.entries(oldDest.scripts)) {
          scriptChanges.push({
            path: `destinations/${destKey}/${name}`,
            type: 'removed',
            oldContent: content,
            unifiedDiff: ChannelDiff.unifiedDiff(content, '', {
              context: ctx,
              header: `destinations/${destKey}/${name}`,
            }),
          });
        }
      } else if (oldDest && newDest) {
        // Destination exists on both sides — diff connector config + scripts
        configChanges.push(
          ...ChannelDiff.diffObjects(
            oldDest.connector,
            newDest.connector,
            `destinations.${destKey}.connector`,
            ignoreWs
          )
        );
        ChannelDiff.diffScriptMaps(
          oldDest.scripts,
          newDest.scripts,
          `destinations/${destKey}`,
          ctx,
          ignoreWs,
          scriptChanges
        );
      }
    }

    const changeCount = configChanges.length + scriptChanges.length;

    // Build summary
    const parts: string[] = [];
    if (configChanges.length > 0) {
      parts.push(`${configChanges.length} config change${configChanges.length === 1 ? '' : 's'}`);
    }
    if (scriptChanges.length > 0) {
      parts.push(`${scriptChanges.length} script change${scriptChanges.length === 1 ? '' : 's'}`);
    }
    const summary = parts.length > 0
      ? `${channelName}: ${parts.join(', ')}`
      : `${channelName}: no changes`;

    return { channelName, changeCount, configChanges, scriptChanges, summary };
  }

  /**
   * Deep compare two objects and return changed paths.
   */
  static diffObjects(
    oldObj: Record<string, unknown>,
    newObj: Record<string, unknown>,
    prefix?: string,
    ignoreWs?: boolean
  ): ConfigChange[] {
    const pfx = prefix ? `${prefix}.` : '';
    const ws = ignoreWs ?? false;
    const changes: ConfigChange[] = [];
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    for (const key of allKeys) {
      const fullPath = `${pfx}${key}`;
      const oldVal = oldObj[key];
      const newVal = newObj[key];
      const oldExists = key in oldObj;
      const newExists = key in newObj;

      if (!oldExists && newExists) {
        changes.push({ path: fullPath, type: 'added', newValue: newVal });
      } else if (oldExists && !newExists) {
        changes.push({ path: fullPath, type: 'removed', oldValue: oldVal });
      } else if (oldExists && newExists) {
        // Both exist — recurse if both are plain objects
        if (isPlainObject(oldVal) && isPlainObject(newVal)) {
          changes.push(...ChannelDiff.diffObjects(oldVal, newVal, fullPath, ws));
        } else if (Array.isArray(oldVal) && Array.isArray(newVal)) {
          // Compare arrays element by element
          const maxLen = Math.max(oldVal.length, newVal.length);
          for (let i = 0; i < maxLen; i++) {
            const elemPath = `${fullPath}[${i}]`;
            const oldElem = i < oldVal.length ? oldVal[i] : undefined;
            const newElem = i < newVal.length ? newVal[i] : undefined;
            const oldElemExists = i < oldVal.length;
            const newElemExists = i < newVal.length;

            if (!oldElemExists && newElemExists) {
              changes.push({ path: elemPath, type: 'added', newValue: newElem });
            } else if (oldElemExists && !newElemExists) {
              changes.push({ path: elemPath, type: 'removed', oldValue: oldElem });
            } else if (isPlainObject(oldElem) && isPlainObject(newElem)) {
              changes.push(...ChannelDiff.diffObjects(
                oldElem as Record<string, unknown>,
                newElem as Record<string, unknown>,
                elemPath,
                ws
              ));
            } else if (!valuesEqual(oldElem, newElem, ws)) {
              changes.push({ path: elemPath, type: 'changed', oldValue: oldElem, newValue: newElem });
            }
          }
        } else if (!valuesEqual(oldVal, newVal, ws)) {
          changes.push({ path: fullPath, type: 'changed', oldValue: oldVal, newValue: newVal });
        }
      }
    }

    return changes;
  }

  /**
   * Generate unified diff for two strings (like `diff -u`).
   */
  static unifiedDiff(
    oldContent: string,
    newContent: string,
    options?: { context?: number; header?: string }
  ): string {
    const ctx = options?.context ?? 3;
    const header = options?.header ?? '';

    // Handle trivial cases
    if (oldContent === newContent) return '';

    const oldLines = oldContent === '' ? [] : oldContent.split('\n');
    const newLines = newContent === '' ? [] : newContent.split('\n');

    // Compute LCS table
    const table = lcsTable(oldLines, newLines, false);
    const diffLines = buildDiffLines(oldLines, newLines, table, false);

    // Build hunks
    const hunks = buildHunks(diffLines, ctx);
    if (hunks.length === 0) return '';

    // Format output
    const oldHeader = header ? `--- old/${header}` : '--- a';
    const newHeader = header ? `+++ new/${header}` : '+++ b';
    const hunkStrings = hunks.map(h => formatHunk(h));

    return [oldHeader, newHeader, ...hunkStrings].join('\n');
  }

  /**
   * Format diff result as human-readable CLI output.
   */
  static formatForCli(result: DiffResult): string {
    if (result.changeCount === 0) {
      return `Channel: ${result.channelName} (no changes)`;
    }

    const lines: string[] = [];
    lines.push(`Channel: ${result.channelName} (${result.changeCount} change${result.changeCount === 1 ? '' : 's'})`);
    lines.push('');

    // Group config changes by their top-level section
    if (result.configChanges.length > 0) {
      // Group by first path component (everything before first dot after prefix)
      const grouped = new Map<string, ConfigChange[]>();
      for (const change of result.configChanges) {
        // Use the path up to the second dot as group key, or full path if no second dot
        const parts = change.path.split('.');
        const groupKey = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0] ?? change.path;
        const existing = grouped.get(groupKey);
        if (existing) {
          existing.push(change);
        } else {
          grouped.set(groupKey, [change]);
        }
      }

      for (const [_group, changes] of grouped) {
        for (const change of changes) {
          switch (change.type) {
            case 'changed':
              lines.push(`  ${change.path}: ${formatValue(change.oldValue)} -> ${formatValue(change.newValue)}`);
              break;
            case 'added':
              lines.push(`  + ${change.path}: ${formatValue(change.newValue)}`);
              break;
            case 'removed':
              lines.push(`  - ${change.path}: ${formatValue(change.oldValue)}`);
              break;
          }
        }
      }
    }

    // Script changes
    for (const change of result.scriptChanges) {
      lines.push('');
      lines.push(`--- ${change.path} ---`);

      if (change.type === 'added') {
        lines.push('(new file)');
      } else if (change.type === 'removed') {
        lines.push('(deleted)');
      }

      if (change.unifiedDiff) {
        // Skip the file headers (--- and +++) since we already printed the path
        const diffLines = change.unifiedDiff.split('\n');
        const hunkStart = diffLines.findIndex(l => l.startsWith('@@'));
        if (hunkStart >= 0) {
          lines.push(...diffLines.slice(hunkStart));
        }
      }
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private static diffScriptMaps(
    oldScripts: Record<string, string>,
    newScripts: Record<string, string>,
    pathPrefix: string,
    contextLines: number,
    ignoreWs: boolean,
    out: ScriptChange[]
  ): void {
    const allScriptKeys = new Set([
      ...Object.keys(oldScripts),
      ...Object.keys(newScripts),
    ]);

    for (const scriptKey of allScriptKeys) {
      const oldContent = oldScripts[scriptKey];
      const newContent = newScripts[scriptKey];
      const path = `${pathPrefix}/${scriptKey}`;
      const oldExists = scriptKey in oldScripts;
      const newExists = scriptKey in newScripts;

      if (!oldExists && newExists) {
        out.push({
          path,
          type: 'added',
          newContent: newContent,
          unifiedDiff: ChannelDiff.unifiedDiff('', newContent!, {
            context: contextLines,
            header: path,
          }),
        });
      } else if (oldExists && !newExists) {
        out.push({
          path,
          type: 'removed',
          oldContent: oldContent,
          unifiedDiff: ChannelDiff.unifiedDiff(oldContent!, '', {
            context: contextLines,
            header: path,
          }),
        });
      } else if (oldExists && newExists) {
        const equal = ignoreWs
          ? normalizeWhitespace(oldContent!) === normalizeWhitespace(newContent!)
          : oldContent === newContent;
        if (!equal) {
          out.push({
            path,
            type: 'changed',
            oldContent: oldContent,
            newContent: newContent,
            unifiedDiff: ChannelDiff.unifiedDiff(oldContent!, newContent!, {
              context: contextLines,
              header: path,
            }),
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatValue(val: unknown): string {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (typeof val === 'string') return val.length > 60 ? `"${val.substring(0, 57)}..."` : `"${val}"`;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return `[${val.length} items]`;
  if (isPlainObject(val)) return `{${Object.keys(val).length} keys}`;
  return String(val);
}
