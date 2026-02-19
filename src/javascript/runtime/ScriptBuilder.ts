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

    // importClass shim — prevents ReferenceError in old Rhino scripts
    script.push('function importClass() { /* no-op: Rhino compatibility shim */ }');

    // importPackage shim — prevents ReferenceError in old Rhino scripts
    script.push('function importPackage() { /* no-op: Rhino compatibility shim */ }');

    return script.join('\n');
  }

  /**
   * Generate a general script with setup code
   */
  generateScript(userScript: string, _contextType?: ContextType): string {
    const builder: string[] = [];

    // Add map functions
    this.appendMapFunctions(builder);

    // Add attachment functions (always included — matches Java: appendAttachmentFunctions is unconditional)
    this.appendAttachmentFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

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

    // Add attachment functions (always included — matches Java: appendAttachmentFunctions is unconditional)
    this.appendAttachmentFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Add code templates if provided
    if (this.options.codeTemplates?.length) {
      for (const template of this.options.codeTemplates) {
        builder.push(this.transpile(template));
      }
    }

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

    // Execute filter then transformer in IIFE (matches Java: serialization is inside doTransform)
    builder.push(
      '(function() { if (doFilter() == true) { doTransform(); return true; } else { return false; } })();'
    );

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

    // Add attachment functions (always included — matches Java: appendAttachmentFunctions is unconditional)
    this.appendAttachmentFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Add code templates if provided
    if (this.options.codeTemplates?.length) {
      for (const template of this.options.codeTemplates) {
        builder.push(this.transpile(template));
      }
    }

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

    // Add attachment functions (always included — matches Java)
    this.appendAttachmentFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Add code templates if provided
    if (this.options.codeTemplates?.length) {
      for (const template of this.options.codeTemplates) {
        builder.push(this.transpile(template));
      }
    }

    // Transpile and wrap user script
    const transpiled = this.transpile(userScript);
    builder.push('function doPreprocess() {');
    builder.push(transpiled);
    builder.push('}');
    // Java behavior: only update message if doPreprocess() returns non-null/undefined.
    // If the user modifies `message` inside the function but doesn't return, Java discards
    // the modification (uses the original raw message). We save the original before calling
    // so we can restore it when the function doesn't explicitly return.
    builder.push('var __pp_original = message;');
    builder.push('var __pp_result = doPreprocess();');
    builder.push(
      'if (__pp_result !== undefined && __pp_result !== null) { message = __pp_result; } else { message = __pp_original; }'
    );

    return builder.join('\n');
  }

  /**
   * Generate postprocessor script
   */
  generatePostprocessorScript(userScript: string): string {
    const builder: string[] = [];

    // Add map functions
    this.appendMapFunctions(builder);

    // Add attachment functions (always included — matches Java)
    this.appendAttachmentFunctions(builder);

    // Add utility functions
    this.appendMiscFunctions(builder);

    // Add code templates if provided
    if (this.options.codeTemplates?.length) {
      for (const template of this.options.codeTemplates) {
        builder.push(this.transpile(template));
      }
    }

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

    // Add all map functions (matches Java: appendMapFunctions)
    this.appendMapFunctions(builder);

    // Add attachment functions (always included — matches Java)
    this.appendAttachmentFunctions(builder);

    // Add utility functions (matches Java: appendMiscFunctions)
    this.appendMiscFunctions(builder);

    // Add code templates if provided
    if (this.options.codeTemplates?.length) {
      for (const template of this.options.codeTemplates) {
        builder.push(this.transpile(template));
      }
    }

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
    const builder: string[] = [];

    // Add all map functions (matches Java: appendMapFunctions)
    this.appendMapFunctions(builder);

    // Add attachment functions (always included — matches Java)
    this.appendAttachmentFunctions(builder);

    // Add utility functions (matches Java: appendMiscFunctions)
    this.appendMiscFunctions(builder);

    // Add code templates if provided
    if (this.options.codeTemplates?.length) {
      for (const template of this.options.codeTemplates) {
        builder.push(this.transpile(template));
      }
    }

    // Transpile and wrap user script
    const transpiled = this.transpile(userScript);
    builder.push('function doUndeploy() {');
    builder.push(transpiled);
    builder.push('}');
    builder.push('doUndeploy();');

    return builder.join('\n');
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

    // Configuration map
    builder.push(
      'function $cfg(key, value) { if (arguments.length === 1) { return configurationMap.get(key); } else { return configurationMap.put(key, value); } }'
    );

    // Secrets (read-only, direct vault access)
    builder.push(
      "function $secrets(key) { if (typeof secretsMap !== 'undefined') { return secretsMap.get(key); } return undefined; }"
    );

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
  if ((result == undefined) || (result.toString().length == 0)) {
    if (defaultValue == undefined) {
      defaultValue = '';
    }
    result = defaultValue;
  }
  if ('string' === typeof result || (typeof result === 'object' && result != null && typeof result.toXMLString === 'function')) {
    result = String(result.toString());
    if (replacement != undefined && replacement != null) {
      for (var i = 0; i < replacement.length; i++) {
        var entry = replacement[i];
        result = result.replace(new RegExp(entry[0], 'g'), entry[1]);
      }
    }
  }
  return result;
}
`);

    // $ function - shortcut for getting mapped values (Java lookup order)
    builder.push(`
function $(string) {
  try {
    if (typeof responseMap !== 'undefined' && responseMap.containsKey(string)) {
      return responseMap.get(string);
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
  try {
    if (typeof configurationMap !== 'undefined' && configurationMap.containsKey(string)) {
      return configurationMap.get(string);
    }
  } catch (e) {}
  try {
    if (typeof resultMap !== 'undefined' && resultMap.containsKey(string)) {
      return resultMap.get(string);
    }
  } catch (e) {}
  return '';
}
`);

    // createSegment helper for HL7
    builder.push(`
function createSegment(name, msgObj, index) {
  if (typeof msgObj === 'undefined' || msgObj === null) {
    return XMLProxy.create('<' + name + '></' + name + '>');
  }
  if (typeof index === 'undefined') {
    index = 0;
  }
  msgObj[name][index] = XMLProxy.create('<' + name + '></' + name + '>');
  return msgObj[name][index];
}
`);

    // Logger shortcuts
    builder.push(`
function debug(message) { logger.debug(message); }
function info(message) { logger.info(message); }
function warn(message) { logger.warn(message); }
function error(message) { logger.error(message); }
`);

    // createSegmentAfter - Insert HL7 segment after existing one
    builder.push(`
function createSegmentAfter(name, segment) {
  var msgObj = segment;
  while (msgObj.parent() != undefined) { msgObj = msgObj.parent(); }
  msgObj.insertChildAfter(segment[0], XMLProxy.create('<' + name + '></' + name + '>'));
  return msgObj.children()[segment[0].childIndex() + 1];
}
`);

    // getArrayOrXmlLength - Handle both XML and array length
    builder.push(`
function getArrayOrXmlLength(obj) {
  if (obj === undefined || obj === null) return 0;
  if (typeof obj.length === 'function') return obj.length();
  if (typeof obj.length === 'number') return obj.length;
  return 0;
}
`);

    // Type coercion functions (used by Mapper plugin)
    builder.push(`
function newStringOrUndefined(value) {
  if (value === undefined || value === null) return value;
  return String(value);
}
function newBooleanOrUndefined(value) {
  if (value === undefined || value === null) return value;
  return Boolean(value);
}
function newNumberOrUndefined(value) {
  if (value === undefined || value === null) return value;
  return Number(value);
}
`);
  }

  /**
   * Append attachment handling functions
   */
  private appendAttachmentFunctions(builder: string[]): void {
    builder.push(`
function getAttachmentIds(channelId, messageId) {
  if (typeof AttachmentUtil !== 'undefined') {
    if (arguments.length === 2) {
      return AttachmentUtil.getMessageAttachmentIds(channelId, messageId);
    } else {
      return AttachmentUtil.getMessageAttachmentIds(connectorMessage);
    }
  }
  return [];
}

function getAttachments(base64Decode) {
  if (typeof AttachmentUtil !== 'undefined') {
    return AttachmentUtil.getMessageAttachments(connectorMessage, !!base64Decode || false);
  }
  return [];
}

function getAttachment() {
  if (typeof AttachmentUtil !== 'undefined') {
    if (arguments.length >= 3) {
      return AttachmentUtil.getMessageAttachment(arguments[0], arguments[1], arguments[2], !!arguments[3] || false);
    } else {
      return AttachmentUtil.getMessageAttachment(connectorMessage, arguments[0], !!arguments[1] || false);
    }
  }
  return null;
}

function addAttachment(data, type, base64Encode) {
  if (typeof AttachmentUtil !== 'undefined') {
    return AttachmentUtil.createAttachment(connectorMessage, data, type, !!base64Encode || false);
  }
  return null;
}

function updateAttachment() {
  if (typeof AttachmentUtil !== 'undefined') {
    if (arguments.length >= 5) {
      return AttachmentUtil.updateAttachment(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], !!arguments[5] || false);
    } else if (arguments.length >= 3) {
      if (arguments[2] && arguments[2] instanceof Attachment) {
        return AttachmentUtil.updateAttachment(arguments[0], arguments[1], arguments[2], !!arguments[3] || false);
      } else {
        return AttachmentUtil.updateAttachment(connectorMessage, arguments[0], arguments[1], arguments[2], !!arguments[3] || false);
      }
    } else {
      return AttachmentUtil.updateAttachment(connectorMessage, arguments[0], !!arguments[1] || false);
    }
  }
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
      builder.push('function doFilter() { phase[0] = "filter"; return true; }');
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
    builder.push('  phase[0] = "filter";');
    builder.push('  return (');

    const ruleExpressions: string[] = [];
    for (let i = 0; i < enabledRules.length; i++) {
      const rule = enabledRules[i]!;
      const expr = `(filterRule${i + 1}() == true)`;

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
      // No steps = still need auto-serialization (matches Java behavior)
      builder.push('function doTransform() {');
      builder.push('  phase[0] = "transform";');
      this.appendAutoSerialization(builder);
      builder.push('}');
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
    builder.push('  phase[0] = "transform";');

    for (let i = 0; i < enabledSteps.length; i++) {
      builder.push(`  transformStep${i + 1}();`);
    }

    // Auto-serialize msg (independent block — matches Java lines 333-342)
    this.appendAutoSerialization(builder);

    builder.push('}');
  }

  /**
   * Append auto-serialization code for msg and tmp.
   * Both are independent if-blocks (not else-if) matching Java lines 333-355.
   * In Node.js, XMLProxy objects have toXMLString(); for plain objects/arrays we JSON.stringify.
   */
  private appendAutoSerialization(builder: string[]): void {
    // Auto-serialize msg
    builder.push("if (typeof msg === 'object' && typeof msg.toXMLString === 'function') {");
    builder.push('  if (msg.hasSimpleContent()) { msg = msg.toXMLString(); }');
    builder.push("} else if (typeof msg !== 'undefined' && msg !== null) {");
    builder.push('  var toStringResult = Object.prototype.toString.call(msg);');
    builder.push(
      "  if (toStringResult == '[object Object]' || toStringResult == '[object Array]') { msg = JSON.stringify(msg); }"
    );
    builder.push('}');
    // Auto-serialize tmp (INDEPENDENT — NOT else-if from msg block)
    builder.push("if (typeof tmp === 'object' && typeof tmp.toXMLString === 'function') {");
    builder.push('  if (tmp.hasSimpleContent()) { tmp = tmp.toXMLString(); }');
    builder.push("} else if (typeof tmp !== 'undefined' && tmp !== null) {");
    builder.push('  var toStringResult = Object.prototype.toString.call(tmp);');
    builder.push(
      "  if (toStringResult == '[object Object]' || toStringResult == '[object Array]') { tmp = JSON.stringify(tmp); }"
    );
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
