/**
 * Type definitions for the E4X Codemod Tool.
 *
 * This tool analyzes and transforms E4X syntax in Mirth Connect channel scripts,
 * bridging the gap between the runtime E4XTranspiler (23+ patterns) and the
 * 14 deferred patterns that require pre-migration transformation.
 */

import type { TranspileWarning } from '../../src/javascript/e4x/E4XTranspiler.js';

// Re-export for convenience
export type { TranspileWarning };

// ─── Pattern Detection ───────────────────────────────────────────────

/**
 * The 17 E4X pattern types the detector can identify.
 * Patterns marked "runtime" are handled by E4XTranspiler automatically.
 * Patterns marked "extended" require the codemod's ExtendedTransforms.
 * Patterns marked "manual" require human review.
 */
export type E4XPatternType =
  // Runtime-handled (E4XTranspiler covers these)
  | 'xml-literal'              // <tag/>
  | 'descendant-access'        // msg..PID
  | 'attribute-read'           // msg.@version
  | 'attribute-write'          // msg.@version = "2.5"
  | 'for-each'                 // for each (var x in list)
  | 'xml-constructor'          // new XML(str)
  | 'xml-append'               // xml += <tag/>
  | 'default-namespace'        // default xml namespace = "uri"
  | 'filter-predicate'         // msg.OBX.(condition)
  | 'wildcard-attribute'       // .@*
  | 'wildcard-element'         // .*
  | 'delete-property'          // delete msg.PID
  // Extended transforms (codemod handles these)
  | 'namespace-constructor'    // new Namespace(uri)
  | 'qname-constructor'        // new QName(ns, localName)
  | 'xml-settings'             // XML.ignoreWhitespace, XML.ignoreComments
  | 'import-class'             // importClass(...)
  // Detection-only (flag for manual review)
  | 'xmllist-constructor';     // new XMLList()

/**
 * Confidence level for pattern detection.
 * Some patterns (like `<` for XML literals) can be ambiguous with comparison operators.
 */
export type PatternConfidence = 'definite' | 'likely' | 'possible';

/**
 * A detected E4X pattern occurrence in a script.
 */
export interface E4XPattern {
  type: E4XPatternType;
  line: number;
  column: number;
  match: string;
  confidence: PatternConfidence;
  /** Whether the runtime E4XTranspiler handles this pattern */
  runtimeHandled: boolean;
}

// ─── Script Location ─────────────────────────────────────────────────

/**
 * Where a script lives within a channel or artifact repo.
 */
export interface ScriptLocation {
  /** Channel name (or code template library name) */
  channelName: string;
  /** Channel ID if available */
  channelId?: string;
  /** Connector name (e.g., "Source", "HTTP Sender") */
  connectorName?: string;
  /** Script type */
  scriptType: ScriptType;
  /** File path (for artifact repos) or XML path (for channel XML) */
  filePath: string;
}

export type ScriptType =
  | 'filter'
  | 'transformer'
  | 'response-transformer'
  | 'deploy'
  | 'undeploy'
  | 'preprocess'
  | 'postprocess'
  | 'code-template';

/**
 * A script extracted from a source with its location metadata.
 */
export interface ExtractedScript {
  location: ScriptLocation;
  content: string;
}

// ─── Analysis Results ────────────────────────────────────────────────

/**
 * Analysis result for a single script.
 */
export interface ScriptAnalysis {
  location: ScriptLocation;
  patterns: E4XPattern[];
  hasE4X: boolean;
  /** Count of patterns handled by runtime transpiler */
  runtimeHandledCount: number;
  /** Count of patterns needing codemod extended transforms */
  extendedCount: number;
  /** Count of patterns requiring manual review */
  manualReviewCount: number;
}

/**
 * Aggregated analysis for a single channel.
 */
export interface ChannelAnalysis {
  channelName: string;
  channelId?: string;
  scripts: ScriptAnalysis[];
  totalPatterns: number;
  runtimeHandledTotal: number;
  extendedTotal: number;
  manualReviewTotal: number;
  /** Channel is fully safe for takeover without codemod */
  safeForTakeover: boolean;
}

/**
 * Full analysis report across all sources.
 */
export interface AnalysisReport {
  timestamp: string;
  sourceType: 'channel-xml' | 'artifact-repo';
  sourcePath: string;
  channels: ChannelAnalysis[];
  /** Summary counts */
  summary: {
    totalChannels: number;
    totalScripts: number;
    scriptsWithE4X: number;
    totalPatterns: number;
    runtimeHandledPatterns: number;
    extendedPatterns: number;
    manualReviewPatterns: number;
    channelsSafeForTakeover: number;
    channelsRequiringCodemod: number;
  };
  /** Pattern type histogram */
  patternHistogram: Record<E4XPatternType, number>;
}

// ─── Transformation Results ──────────────────────────────────────────

/**
 * Result of transforming a single script.
 */
export interface TransformResult {
  location: ScriptLocation;
  original: string;
  transformed: string;
  changed: boolean;
  /** Patterns that were transformed */
  transformedPatterns: E4XPatternType[];
  /** Warnings from the transformation */
  warnings: TransformWarning[];
  /** Patterns that could not be transformed (manual review needed) */
  untransformablePatterns: E4XPattern[];
}

/**
 * Warning generated during transformation.
 */
export interface TransformWarning {
  line: number;
  message: string;
  severity: 'info' | 'warn' | 'error';
}

/**
 * Aggregated transform results for a channel.
 */
export interface ChannelTransformResult {
  channelName: string;
  channelId?: string;
  scripts: TransformResult[];
  totalChanges: number;
  totalWarnings: number;
}

// ─── Verification ────────────────────────────────────────────────────

/**
 * Result of verifying a single script's transformation.
 */
export interface VerificationResult {
  location: ScriptLocation;
  passed: boolean;
  /** The codemod-transformed output */
  codemodOutput: string;
  /** The runtime transpiler output (for comparison) */
  runtimeOutput: string;
  /** Differences between codemod and runtime output (empty if passed) */
  differences: string[];
  /** Extended transforms are expected to diverge from runtime */
  hasExtendedTransforms: boolean;
}

/**
 * Full verification report.
 */
export interface VerificationReport {
  timestamp: string;
  results: VerificationResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    extendedDivergences: number;
  };
}

// ─── Source Interface ────────────────────────────────────────────────

/**
 * Interface for script extraction sources.
 * Implementations extract scripts from channel XML files or artifact repos.
 */
export interface ScriptSource {
  /** Extract all scripts from this source */
  extractScripts(): ExtractedScript[];
  /** Source type identifier */
  readonly sourceType: 'channel-xml' | 'artifact-repo';
  /** Source path (file or directory) */
  readonly sourcePath: string;
}

// ─── CLI Options ─────────────────────────────────────────────────────

export interface AnalyzeOptions {
  channelXml?: string[];
  repo?: string;
  json?: boolean;
  verbose?: boolean;
  pattern?: E4XPatternType;
  unsupportedOnly?: boolean;
  output?: string;
}

export interface TransformOptions {
  channelXml?: string[];
  repo?: string;
  json?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  backup?: boolean;
  backupDir?: string;
  verify?: boolean;
  extendedOnly?: boolean;
}

export interface DiffOptions {
  channelXml?: string[];
  repo?: string;
  json?: boolean;
  verbose?: boolean;
}

export interface VerifyOptions {
  channelXml?: string[];
  repo?: string;
  json?: boolean;
  verbose?: boolean;
}
