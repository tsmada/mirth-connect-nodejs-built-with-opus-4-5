import chalk from 'chalk';
import type { ScriptLocation, TransformResult } from '../types.js';

export interface DiffFormatOptions {
  contextLines?: number;
  color?: boolean;
}

export class DiffFormatter {
  private contextLines: number;
  private color: boolean;

  constructor(options: DiffFormatOptions = {}) {
    this.contextLines = options.contextLines ?? 3;
    this.color = options.color ?? true;
  }

  formatDiff(result: TransformResult): string {
    if (!result.changed) return '';

    const loc = this.formatLocation(result.location);
    const origLines = result.original.split('\n');
    const transLines = result.transformed.split('\n');

    const header = [
      this.styled(`--- ${loc} (original)`, chalk.red),
      this.styled(`+++ ${loc} (transformed)`, chalk.green),
    ];

    const hunks = this.buildHunks(origLines, transLines);
    return [...header, ...hunks].join('\n');
  }

  formatDiffs(results: TransformResult[]): string {
    const diffs = results
      .filter(r => r.changed)
      .map(r => this.formatDiff(r));

    if (diffs.length === 0) return 'No changes.';
    return diffs.join('\n\n');
  }

  private formatLocation(location: ScriptLocation): string {
    const parts = [location.channelName];
    if (location.connectorName) parts.push(location.connectorName);
    parts.push(location.scriptType);
    return parts.join(' > ');
  }

  private buildHunks(origLines: string[], transLines: string[]): string[] {
    // Simple LCS-based diff: find changed line ranges
    const changes = this.findChanges(origLines, transLines);
    if (changes.length === 0) return [];

    const output: string[] = [];
    // Group changes into hunks with context
    let i = 0;

    while (i < changes.length) {
      const change = changes[i]!;
      const hunkChanges: typeof changes = [change];

      // Merge nearby changes into one hunk
      let j = i + 1;
      while (j < changes.length) {
        const next = changes[j]!;
        const gap = next.origStart - (hunkChanges[hunkChanges.length - 1]!.origEnd);
        if (gap <= this.contextLines * 2) {
          hunkChanges.push(next);
          j++;
        } else {
          break;
        }
      }

      // Build hunk with context
      const firstChange = hunkChanges[0]!;
      const lastChange = hunkChanges[hunkChanges.length - 1]!;

      const ctxBefore = Math.max(0, firstChange.origStart - this.contextLines);
      const ctxAfterOrig = Math.min(origLines.length, lastChange.origEnd + this.contextLines);
      const ctxAfterTrans = Math.min(transLines.length, lastChange.transEnd + this.contextLines);

      // Calculate hunk header line counts
      const origCount = ctxAfterOrig - ctxBefore;
      const transStart = ctxBefore; // simplified: same start due to line-by-line
      const transCount = ctxAfterTrans - ctxBefore;

      output.push(this.styled(
        `@@ -${ctxBefore + 1},${origCount} +${transStart + 1},${transCount} @@`,
        chalk.cyan
      ));

      // Emit context before first change
      for (let l = ctxBefore; l < firstChange.origStart; l++) {
        output.push(this.styled(` ${origLines[l] ?? ''}`, chalk.gray));
      }

      // Emit each change with interleaved context
      for (let ci = 0; ci < hunkChanges.length; ci++) {
        const c = hunkChanges[ci]!;

        // Context between changes
        if (ci > 0) {
          const prev = hunkChanges[ci - 1]!;
          for (let l = prev.origEnd; l < c.origStart; l++) {
            output.push(this.styled(` ${origLines[l] ?? ''}`, chalk.gray));
          }
        }

        // Removed lines
        for (let l = c.origStart; l < c.origEnd; l++) {
          output.push(this.styled(`-${origLines[l] ?? ''}`, chalk.red));
        }
        // Added lines
        for (let l = c.transStart; l < c.transEnd; l++) {
          output.push(this.styled(`+${transLines[l] ?? ''}`, chalk.green));
        }
      }

      // Context after last change
      for (let l = lastChange.origEnd; l < ctxAfterOrig; l++) {
        output.push(this.styled(` ${origLines[l] ?? ''}`, chalk.gray));
      }

      i = j;
    }

    return output;
  }

  private findChanges(origLines: string[], transLines: string[]): Array<{
    origStart: number; origEnd: number;
    transStart: number; transEnd: number;
  }> {
    const changes: Array<{
      origStart: number; origEnd: number;
      transStart: number; transEnd: number;
    }> = [];

    let oi = 0;
    let ti = 0;

    while (oi < origLines.length || ti < transLines.length) {
      if (oi < origLines.length && ti < transLines.length && origLines[oi] === transLines[ti]) {
        oi++;
        ti++;
        continue;
      }

      // Found a difference — find extent
      const origStart = oi;
      const transStart = ti;

      // Look ahead for the next matching line
      let found = false;
      for (let lookahead = 1; lookahead <= 20 && !found; lookahead++) {
        // Check if removing `lookahead` original lines realigns
        if (oi + lookahead < origLines.length && ti < transLines.length &&
            origLines[oi + lookahead] === transLines[ti]) {
          changes.push({ origStart, origEnd: oi + lookahead, transStart, transEnd: ti });
          oi += lookahead;
          found = true;
        }
        // Check if adding `lookahead` transformed lines realigns
        if (!found && oi < origLines.length && ti + lookahead < transLines.length &&
            origLines[oi] === transLines[ti + lookahead]) {
          changes.push({ origStart, origEnd: oi, transStart, transEnd: ti + lookahead });
          ti += lookahead;
          found = true;
        }
      }

      if (!found) {
        // Lines are changed 1:1 (replacement)
        changes.push({
          origStart,
          origEnd: Math.min(oi + 1, origLines.length),
          transStart,
          transEnd: Math.min(ti + 1, transLines.length),
        });
        if (oi < origLines.length) oi++;
        if (ti < transLines.length) ti++;
      }
    }

    return changes;
  }

  private styled(text: string, colorFn: (s: string) => string): string {
    return this.color ? colorFn(text) : text;
  }
}
