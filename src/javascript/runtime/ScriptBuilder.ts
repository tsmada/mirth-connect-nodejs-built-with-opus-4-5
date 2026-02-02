/**
 * ScriptBuilder - Generates executable JavaScript from Mirth scripts
 *
 * Ported from: com.mirth.connect.server.builders.JavaScriptBuilder
 *
 * Purpose: Wrap user scripts with setup code, map functions, and utilities
 *
 * Key behaviors:
 * - Transpile E4X syntax before execution
 * - Generate filter/transformer scripts
 * - Add map shortcut functions
 * - Add utility functions (validate, $, etc.)
 */

import { transpileE4X } from '../e4x/E4XTranspiler.js';

/**
 * Serialization type for message data
 */
export enum SerializationType {
  XML = 'XML',
  JSON = 'JSON',
  RAW = 'RAW',
}

/**
 * Script context type
 */
export enum ContextType {
  GLOBAL_DEPLOY = 'GLOBAL_DEPLOY',
  GLOBAL_UNDEPLOY = 'GLOBAL_UNDEPLOY',
  GLOBAL_PREPROCESSOR = 'GLOBAL_PREPROCESSOR',
  GLOBAL_POSTPROCESSOR = 'GLOBAL_POSTPROCESSOR',
  CHANNEL_DEPLOY = 'CHANNEL_DEPLOY',
  CHANNEL_UNDEPLOY = 'CHANNEL_UNDEPLOY',
  CHANNEL_PREPROCESSOR = 'CHANNEL_PREPROCESSOR',
  CHANNEL_POSTPROCESSOR = 'CHANNEL_POSTPROCESSOR',
  SOURCE_FILTER_TRANSFORMER = 'SOURCE_FILTER_TRANSFORMER',
  DESTINATION_FILTER_TRANSFORMER = 'DESTINATION_FILTER_TRANSFORMER',
  SOURCE_RECEIVER = 'SOURCE_RECEIVER',
  DESTINATION_DISPATCHER = 'DESTINATION_DISPATCHER',
  DESTINATION_RESPONSE_TRANSFORMER = 'DESTINATION_RESPONSE_TRANSFORMER',
}

/**
 * Options for script generation
 */
export interface ScriptOptions {
  /** Include attachment handling functions */
  includeAttachmentFunctions?: boolean;
  /** Include batch processing functions */
  includeBatchFunctions?: boolean;
  /** Custom code templates to include */
  codeTemplates?: string[];
  /** Whether to transpile E4X syntax */
  transpileE4X?: boolean;
}

/**
 * Filter rule configuration
 */
export interface FilterRule {
  name: string;
  script: string;
  operator: 'AND' | 'OR';
  enabled: boolean;
}

/**
 * Transformer step configuration
 */
export interface TransformerStep {
  name: string;
  script: string;
  enabled: boolean;
}

/**
 * ScriptBuilder class
 */
export class ScriptBuilder {
  private options: ScriptOptions;

  constructor(options: ScriptOptions = {}) {
    this.options = {
      transpileE4X: true,
      ...options,
    };
  }

  /**
   * Generate the global sealed script (base utilities)
   */
  generateGlobalSealedScript(): string {
    const script: string[] = [];

    // String.prototype.trim (for compatibility)
    script.push(
      'if (!String.prototype.trim) { String.prototype.trim = function() { return this.replace(/^\\s+|\\s+$/g,""); }; }'
    );

    // XML configuration (for XMLProxy)
    script.push('const XML = XMLProxy;');
    script.push('const XMLList = { create: () => [] };');

    return script.join('\n');
  }

  /**
   * Generate a general script with setup code
   */
  generateScript(userScript: string, _contextType?: ContextType): string {
    const builder: string[] = [];

    // Add map functions
    this.appendMapFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Add attachment functions if requested
    if (this.options.includeAttachmentFunctions) {
      this.appendAttachmentFunctions(builder);
    }

    // Add code templates if provided
    if (this.options.codeTemplates?.length) {
      for (const template of this.options.codeTemplates) {
        builder.push(this.transpile(template));
      }
    }

    // Wrap user script
    const transpiled = this.transpile(userScript);
    builder.push('function doScript() {');
    builder.push(transpiled);
    builder.push('}');
    builder.push('doScript();');

    return builder.join('\n');
  }

  /**
   * Generate filter/transformer script
   */
  generateFilterTransformerScript(
    filterRules: FilterRule[],
    transformerSteps: TransformerStep[],
    inboundType: SerializationType,
    outboundType: SerializationType,
    hasTemplate: boolean
  ): string {
    const builder: string[] = [];

    // Add map functions
    this.appendMapFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Initialize msg based on inbound type
    switch (inboundType) {
      case SerializationType.JSON:
        builder.push('msg = JSON.parse(connectorMessage.getTransformedData());');
        break;
      case SerializationType.XML:
        builder.push('msg = XMLProxy.create(connectorMessage.getTransformedData());');
        builder.push(
          "if (typeof msg.namespace === 'function' && msg.namespace('') !== undefined) { setDefaultXmlNamespace(msg.namespace('')); } else { setDefaultXmlNamespace(''); }"
        );
        break;
      case SerializationType.RAW:
        builder.push(
          'msg = connectorMessage.getProcessedRawData() || connectorMessage.getRawData();'
        );
        break;
    }

    // Initialize tmp based on outbound type (if template exists)
    if (hasTemplate) {
      switch (outboundType) {
        case SerializationType.JSON:
          builder.push('tmp = JSON.parse(template);');
          break;
        case SerializationType.XML:
          builder.push('tmp = XMLProxy.create(template);');
          break;
        case SerializationType.RAW:
          builder.push('tmp = template;');
          break;
      }
    }

    // Generate filter function
    this.appendFilterScript(builder, filterRules);

    // Generate transformer function
    this.appendTransformerScript(builder, transformerSteps);

    // Execute filter then transformer (wrapped in IIFE for return statement)
    builder.push('(function() {');
    builder.push('  if (doFilter() === true) { doTransform(); return true; } else { return false; }');
    builder.push('})();');

    return builder.join('\n');
  }

  /**
   * Generate response transformer script
   */
  generateResponseTransformerScript(
    transformerSteps: TransformerStep[],
    inboundType: SerializationType,
    outboundType: SerializationType,
    hasTemplate: boolean
  ): string {
    const builder: string[] = [];

    // Add map functions
    this.appendMapFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Initialize msg based on inbound type
    switch (inboundType) {
      case SerializationType.JSON:
        builder.push('msg = JSON.parse(connectorMessage.getResponseTransformedData());');
        break;
      case SerializationType.XML:
        builder.push('msg = XMLProxy.create(connectorMessage.getResponseTransformedData());');
        builder.push(
          "if (typeof msg.namespace === 'function' && msg.namespace('') !== undefined) { setDefaultXmlNamespace(msg.namespace('')); } else { setDefaultXmlNamespace(''); }"
        );
        break;
      case SerializationType.RAW:
        builder.push('msg = response.getMessage();');
        break;
    }

    // Initialize tmp based on outbound type (if template exists)
    if (hasTemplate) {
      switch (outboundType) {
        case SerializationType.JSON:
          builder.push('tmp = JSON.parse(template);');
          break;
        case SerializationType.XML:
          builder.push('tmp = XMLProxy.create(template);');
          break;
        case SerializationType.RAW:
          builder.push('tmp = template;');
          break;
      }
    }

    // Generate transformer function
    this.appendTransformerScript(builder, transformerSteps);

    // Execute transformer
    builder.push('doTransform();');

    return builder.join('\n');
  }

  /**
   * Generate preprocessor script
   */
  generatePreprocessorScript(userScript: string): string {
    const builder: string[] = [];

    // Add map functions
    this.appendMapFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Transpile and wrap user script
    const transpiled = this.transpile(userScript);
    builder.push('function doPreprocess() {');
    builder.push(transpiled);
    builder.push('}');
    builder.push('message = doPreprocess() || message;');

    return builder.join('\n');
  }

  /**
   * Generate postprocessor script
   */
  generatePostprocessorScript(userScript: string): string {
    const builder: string[] = [];

    // Add map functions
    this.appendMapFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Transpile and wrap user script
    const transpiled = this.transpile(userScript);
    builder.push('function doPostprocess() {');
    builder.push(transpiled);
    builder.push('}');
    builder.push('doPostprocess();');

    return builder.join('\n');
  }

  /**
   * Generate deploy script
   */
  generateDeployScript(userScript: string): string {
    const builder: string[] = [];

    // Add map functions (limited set for deploy)
    builder.push(
      'function $g(key, value) { if (arguments.length === 1) { return globalMap.get(key); } else { return globalMap.put(key, value); } }'
    );
    builder.push(
      'function $gc(key, value) { if (arguments.length === 1) { return globalChannelMap.get(key); } else { return globalChannelMap.put(key, value); } }'
    );
    builder.push(
      'function $cfg(key) { return configurationMap.get(key); }'
    );

    // Transpile and wrap user script
    const transpiled = this.transpile(userScript);
    builder.push('function doDeploy() {');
    builder.push(transpiled);
    builder.push('}');
    builder.push('doDeploy();');

    return builder.join('\n');
  }

  /**
   * Generate undeploy script
   */
  generateUndeployScript(userScript: string): string {
    return this.generateDeployScript(userScript).replace(/doDeploy/g, 'doUndeploy');
  }

  /**
   * Append map shortcut functions
   */
  private appendMapFunctions(builder: string[]): void {
    // Connector map
    builder.push(
      'function $co(key, value) { if (arguments.length === 1) { return connectorMap.get(key); } else { return connectorMap.put(key, value); } }'
    );

    // Channel map
    builder.push(
      'function $c(key, value) { if (arguments.length === 1) { return channelMap.get(key); } else { return channelMap.put(key, value); } }'
    );

    // Source map
    builder.push(
      'function $s(key, value) { if (arguments.length === 1) { return sourceMap.get(key); } else { return sourceMap.put(key, value); } }'
    );

    // Global channel map
    builder.push(
      'function $gc(key, value) { if (arguments.length === 1) { return globalChannelMap.get(key); } else { return globalChannelMap.put(key, value); } }'
    );

    // Global map
    builder.push(
      'function $g(key, value) { if (arguments.length === 1) { return globalMap.get(key); } else { return globalMap.put(key, value); } }'
    );

    // Configuration map (read-only)
    builder.push('function $cfg(key) { return configurationMap.get(key); }');

    // Response map
    builder.push(
      'function $r(key, value) { if (arguments.length === 1) { return responseMap.get(key); } else { return responseMap.put(key, value); } }'
    );
  }

  /**
   * Append utility functions
   */
  private appendMiscFunctions(builder: string[]): void {
    // Validate function - returns value or default
    builder.push(`
function validate(mapping, defaultValue, replacement) {
  var result = mapping;
  if (result === undefined || result === null || result.toString().length === 0) {
    if (defaultValue === undefined) {
      result = '';
    } else {
      result = defaultValue;
    }
  }
  if (replacement !== undefined && replacement !== null) {
    result = result.toString().replaceAll(replacement[0], replacement[1]);
  }
  return result;
}
`);

    // $ function - shortcut for getting mapped values
    builder.push(`
function $(string) {
  try {
    if (typeof localMap !== 'undefined' && localMap.containsKey(string)) {
      return localMap.get(string);
    }
  } catch (e) {}
  try {
    if (typeof connectorMap !== 'undefined' && connectorMap.containsKey(string)) {
      return connectorMap.get(string);
    }
  } catch (e) {}
  try {
    if (typeof channelMap !== 'undefined' && channelMap.containsKey(string)) {
      return channelMap.get(string);
    }
  } catch (e) {}
  try {
    if (typeof sourceMap !== 'undefined' && sourceMap.containsKey(string)) {
      return sourceMap.get(string);
    }
  } catch (e) {}
  try {
    if (typeof globalChannelMap !== 'undefined' && globalChannelMap.containsKey(string)) {
      return globalChannelMap.get(string);
    }
  } catch (e) {}
  try {
    if (typeof globalMap !== 'undefined' && globalMap.containsKey(string)) {
      return globalMap.get(string);
    }
  } catch (e) {}
  return '';
}
`);

    // createSegment helper for HL7
    builder.push(`
function createSegment(name, msg, index) {
  if (typeof msg === 'undefined' || msg === null) {
    return XMLProxy.create('<' + name + '/>');
  }
  if (typeof index === 'undefined') {
    index = 0;
  }
  var seg = XMLProxy.create('<' + name + '/>');
  // Insert at appropriate position
  return seg;
}
`);

    // Logger shortcuts
    builder.push(`
function debug(message) { logger.debug(message); }
function info(message) { logger.info(message); }
function warn(message) { logger.warn(message); }
function error(message) { logger.error(message); }
`);
  }

  /**
   * Append attachment handling functions
   */
  private appendAttachmentFunctions(builder: string[]): void {
    builder.push(`
function getAttachmentIds(channelId, messageId) {
  // Placeholder - would integrate with attachment storage
  return [];
}

function getAttachment(channelId, messageId, attachmentId) {
  // Placeholder - would integrate with attachment storage
  return null;
}

function addAttachment(data, type, base64Encode) {
  // Placeholder - would integrate with attachment storage
  return null;
}
`);
  }

  /**
   * Append filter script with rules
   */
  private appendFilterScript(builder: string[], rules: FilterRule[]): void {
    const enabledRules = rules.filter((r) => r.enabled);

    if (enabledRules.length === 0) {
      // No rules = accept all
      builder.push('function doFilter() { phase = "filter"; return true; }');
      return;
    }

    // Generate individual rule functions
    for (let i = 0; i < enabledRules.length; i++) {
      const rule = enabledRules[i]!;
      const transpiled = this.transpile(rule.script);
      builder.push(`function filterRule${i + 1}() {`);
      builder.push(transpiled);
      builder.push('}');
    }

    // Generate doFilter function that combines rules
    builder.push('function doFilter() {');
    builder.push('  phase = "filter";');
    builder.push('  return (');

    const ruleExpressions: string[] = [];
    for (let i = 0; i < enabledRules.length; i++) {
      const rule = enabledRules[i]!;
      const expr = `filterRule${i + 1}()`;

      if (i === 0) {
        ruleExpressions.push(expr);
      } else {
        const op = rule.operator === 'OR' ? '||' : '&&';
        ruleExpressions.push(`${op} ${expr}`);
      }
    }

    builder.push('    ' + ruleExpressions.join('\n    '));
    builder.push('  );');
    builder.push('}');
  }

  /**
   * Append transformer script with steps
   */
  private appendTransformerScript(builder: string[], steps: TransformerStep[]): void {
    const enabledSteps = steps.filter((s) => s.enabled);

    if (enabledSteps.length === 0) {
      // No steps = do nothing
      builder.push('function doTransform() { phase = "transform"; }');
      return;
    }

    // Generate individual step functions
    for (let i = 0; i < enabledSteps.length; i++) {
      const step = enabledSteps[i]!;
      const transpiled = this.transpile(step.script);
      builder.push(`function transformStep${i + 1}() {`);
      builder.push(transpiled);
      builder.push('}');
    }

    // Generate doTransform function that calls all steps
    builder.push('function doTransform() {');
    builder.push('  phase = "transform";');

    for (let i = 0; i < enabledSteps.length; i++) {
      builder.push(`  transformStep${i + 1}();`);
    }

    builder.push('}');
  }

  /**
   * Transpile E4X syntax if enabled
   */
  private transpile(script: string): string {
    if (this.options.transpileE4X) {
      return transpileE4X(script);
    }
    return script;
  }
}

/**
 * Convenience function to create a ScriptBuilder
 */
export function createScriptBuilder(options?: ScriptOptions): ScriptBuilder {
  return new ScriptBuilder(options);
}

/**
 * Default script builder instance
 */
export const scriptBuilder = new ScriptBuilder();
