/**
 * Codemod Engine
 *
 * Top-level orchestrator that composes detection + transformation into
 * channel-grouped workflows. Accepts ScriptSource implementations and
 * produces per-channel analysis reports and transform results.
 */

import { E4XDetector } from './E4XDetector.js';
import { ScriptTransformer } from './ScriptTransformer.js';
import type {
  ScriptSource,
  AnalysisReport,
  ChannelAnalysis,
  ScriptAnalysis,
  TransformResult,
  ChannelTransformResult,
  E4XPatternType,
} from '../types.js';

export class CodemodEngine {
  private detector = new E4XDetector();
  private transformer = new ScriptTransformer();

  /**
   * Analyze all scripts from the given sources.
   * Groups results by channel and produces summary statistics.
   */
  analyze(sources: ScriptSource[]): AnalysisReport {
    const allAnalyses: ScriptAnalysis[] = [];
    let sourceType: 'channel-xml' | 'artifact-repo' = 'channel-xml';
    let sourcePath = '';

    for (const source of sources) {
      sourceType = source.sourceType;
      sourcePath = source.sourcePath;

      const scripts = source.extractScripts();
      for (const script of scripts) {
        const patterns = this.detector.detect(script.content);
        const hasE4X = patterns.length > 0;

        const runtimeHandledCount = patterns.filter(p => p.runtimeHandled).length;
        const extendedCount = patterns.filter(p => !p.runtimeHandled && p.type !== 'xmllist-constructor').length;
        const manualReviewCount = patterns.filter(p => p.type === 'xmllist-constructor').length;

        allAnalyses.push({
          location: script.location,
          patterns,
          hasE4X,
          runtimeHandledCount,
          extendedCount,
          manualReviewCount,
        });
      }
    }

    // Group by channel
    const channelMap = new Map<string, ScriptAnalysis[]>();
    for (const analysis of allAnalyses) {
      const key = analysis.location.channelName;
      if (!channelMap.has(key)) {
        channelMap.set(key, []);
      }
      channelMap.get(key)!.push(analysis);
    }

    const channels: ChannelAnalysis[] = [];
    const patternHistogram: Record<string, number> = {};

    for (const [channelName, scripts] of channelMap) {
      const totalPatterns = scripts.reduce((sum, s) => sum + s.patterns.length, 0);
      const runtimeHandledTotal = scripts.reduce((sum, s) => sum + s.runtimeHandledCount, 0);
      const extendedTotal = scripts.reduce((sum, s) => sum + s.extendedCount, 0);
      const manualReviewTotal = scripts.reduce((sum, s) => sum + s.manualReviewCount, 0);

      // Safe for takeover if ALL patterns are runtime-handled
      const safeForTakeover = extendedTotal === 0 && manualReviewTotal === 0;

      const channelId = scripts[0]?.location.channelId;

      channels.push({
        channelName,
        channelId,
        scripts,
        totalPatterns,
        runtimeHandledTotal,
        extendedTotal,
        manualReviewTotal,
        safeForTakeover,
      });

      // Build histogram
      for (const script of scripts) {
        for (const p of script.patterns) {
          patternHistogram[p.type] = (patternHistogram[p.type] ?? 0) + 1;
        }
      }
    }

    const totalScripts = allAnalyses.length;
    const scriptsWithE4X = allAnalyses.filter(a => a.hasE4X).length;

    return {
      timestamp: new Date().toISOString(),
      sourceType,
      sourcePath,
      channels,
      summary: {
        totalChannels: channels.length,
        totalScripts,
        scriptsWithE4X,
        totalPatterns: Object.values(patternHistogram).reduce((s, n) => s + n, 0),
        runtimeHandledPatterns: channels.reduce((s, c) => s + c.runtimeHandledTotal, 0),
        extendedPatterns: channels.reduce((s, c) => s + c.extendedTotal, 0),
        manualReviewPatterns: channels.reduce((s, c) => s + c.manualReviewTotal, 0),
        channelsSafeForTakeover: channels.filter(c => c.safeForTakeover).length,
        channelsRequiringCodemod: channels.filter(c => !c.safeForTakeover).length,
      },
      patternHistogram: patternHistogram as Record<E4XPatternType, number>,
    };
  }

  /**
   * Transform all scripts from the given sources.
   * Returns per-channel transform results.
   */
  transform(sources: ScriptSource[]): ChannelTransformResult[] {
    const allResults: TransformResult[] = [];

    for (const source of sources) {
      const scripts = source.extractScripts();
      for (const script of scripts) {
        const result = this.transformer.transform(script.content, script.location);
        allResults.push(result);
      }
    }

    // Group by channel
    const channelMap = new Map<string, TransformResult[]>();
    for (const result of allResults) {
      const key = result.location.channelName;
      if (!channelMap.has(key)) {
        channelMap.set(key, []);
      }
      channelMap.get(key)!.push(result);
    }

    const channelResults: ChannelTransformResult[] = [];
    for (const [channelName, scripts] of channelMap) {
      const channelId = scripts[0]?.location.channelId;
      const totalChanges = scripts.filter(s => s.changed).length;
      const totalWarnings = scripts.reduce((sum, s) => sum + s.warnings.length, 0);

      channelResults.push({
        channelName,
        channelId,
        scripts,
        totalChanges,
        totalWarnings,
      });
    }

    return channelResults;
  }

  /**
   * Generate diffs for all scripts (transform without writing).
   * Returns flat array of TransformResults with changed scripts only.
   */
  diff(sources: ScriptSource[]): TransformResult[] {
    const allResults: TransformResult[] = [];

    for (const source of sources) {
      const scripts = source.extractScripts();
      for (const script of scripts) {
        const result = this.transformer.transform(script.content, script.location);
        if (result.changed) {
          allResults.push(result);
        }
      }
    }

    return allResults;
  }
}
