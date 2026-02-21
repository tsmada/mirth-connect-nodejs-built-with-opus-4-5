/**
 * JavaScriptExecutor - Executes JavaScript scripts in a sandboxed VM
 *
 * Ported from: com.mirth.connect.server.util.javascript.JavaScriptExecutor
 *
 * Purpose: Execute user scripts with proper scope setup and error handling
 *
 * Key behaviors:
 * - Execute scripts in isolated VM context
 * - Build scope with all required Mirth variables
 * - Transpile E4X syntax before execution
 * - Handle script errors gracefully
 * - Support filter/transformer, preprocessor, postprocessor scripts
 */

import * as vm from 'vm';
import {
  ScriptBuilder,
  FilterRule,
  TransformerStep,
  SerializationType,
  ScriptOptions,
} from './ScriptBuilder.js';
import {
  buildBasicScope,
  buildChannelScope,
  buildFilterTransformerScope,
  buildResponseTransformerScope,
  buildPreprocessorScope,
  buildPostprocessorScope,
  buildDeployScope,
  syncMapsToConnectorMessage,
  ScriptContext,
  ScriptLogger,
  Scope,
} from './ScopeBuilder.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Message } from '../../model/Message.js';
import { Response } from '../../model/Response.js';
import { Status } from '../../model/Status.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('javascript', 'Script execution engine');
const logger = getLogger('javascript');

const WALL_TIMEOUT_MS = parseInt(process.env.MIRTH_SCRIPT_WALL_TIMEOUT || '60000', 10);

/**
 * Script execution result
 */
export interface ExecutionResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: Error;
  executionTime: number;
}

/**
 * Filter result
 */
export interface FilterResult {
  accepted: boolean;
  error?: Error;
}

/**
 * Transformer result
 */
export interface TransformerResult {
  transformed: boolean;
  output?: string;
  error?: Error;
}

/**
 * Execution options
 */
export interface ExecutionOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Script options for ScriptBuilder */
  scriptOptions?: ScriptOptions;
  /** Custom logger */
  logger?: ScriptLogger;
}

/**
 * JavaScriptExecutor class
 */
export class JavaScriptExecutor {
  private scriptBuilder: ScriptBuilder;
  private defaultTimeout: number;
  private sealedScript: vm.Script | null = null;

  constructor(options: ScriptOptions = {}) {
    this.scriptBuilder = new ScriptBuilder(options);
    this.defaultTimeout = parseInt(process.env.MIRTH_SCRIPT_TIMEOUT || '30000', 10);
  }

  /**
   * Initialize the executor (compile sealed script)
   */
  initialize(): void {
    const sealedSource = this.scriptBuilder.generateGlobalSealedScript();
    this.sealedScript = new vm.Script(sealedSource, { filename: 'sealed.js' });
  }

  /**
   * Create a VM context with the given scope
   */
  private createContext(scope: Scope): vm.Context {
    const context = vm.createContext(scope);

    // Run sealed script to set up globals
    if (this.sealedScript) {
      this.sealedScript.runInContext(context);
    }

    return context;
  }

  /**
   * Execute a script in the given context
   */
  private executeScript<T>(
    script: string,
    context: vm.Context,
    timeout: number
  ): ExecutionResult<T> {
    const startTime = Date.now();

    try {
      const compiled = new vm.Script(script, { filename: 'script.js' });
      const result = compiled.runInContext(context, { timeout }) as T;
      const elapsed = Date.now() - startTime;

      if (elapsed > WALL_TIMEOUT_MS) {
        logger.warn(
          `Script wall-clock timeout exceeded: ${elapsed}ms (limit: ${WALL_TIMEOUT_MS}ms). This may indicate blocking I/O in user script.`
        );
      }

      return {
        success: true,
        result,
        executionTime: elapsed,
      };
    } catch (error) {
      return {
        success: false,
        // Cross-realm error handling: VM context errors are not instanceof the
        // outer realm's Error, so check for the 'message' property instead.
        error: (error && typeof error === 'object' && 'message' in error)
          ? new Error((error as Error).message)
          : new Error(String(error)),
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a general script
   */
  executeScript_(
    userScript: string,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): ExecutionResult {
    const timeout = options.timeout ?? this.defaultTimeout;
    const scope = buildChannelScope(scriptContext);

    const generatedScript = this.scriptBuilder.generateScript(userScript);
    const context = this.createContext(scope);

    return this.executeScript(generatedScript, context, timeout);
  }

  /**
   * Execute a filter/transformer script
   */
  executeFilterTransformer(
    filterRules: FilterRule[],
    transformerSteps: TransformerStep[],
    connectorMessage: ConnectorMessage,
    rawContent: string,
    template: string,
    inboundType: SerializationType,
    outboundType: SerializationType,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): ExecutionResult<boolean> {
    const timeout = options.timeout ?? this.defaultTimeout;

    // Set transformed data on connector message (script reads from this)
    connectorMessage.setTransformedData(rawContent);

    // Build scope
    const scope = buildFilterTransformerScope(
      scriptContext,
      connectorMessage,
      rawContent,
      template,
      'filter'
    );

    // Generate script
    const generatedScript = this.scriptBuilder.generateFilterTransformerScript(
      filterRules,
      transformerSteps,
      inboundType,
      outboundType,
      !!template
    );

    // Create context and execute
    const context = this.createContext(scope);
    const result = this.executeScript<boolean>(generatedScript, context, timeout);

    // Sync maps back to connector message
    if (result.success) {
      syncMapsToConnectorMessage(scope, connectorMessage);

      // JRC-SBD-012: Read transformed data back from VM scope
      // Java: JavaScriptScopeUtil.getTransformedDataFromScope() reads scope["tmp"] (if template)
      // or scope["msg"] (otherwise) and returns the serialized string to the pipeline.
      // Without this, transformer modifications to msg are silently discarded.
      const hasTemplate = !!template;
      const transformedVarName = hasTemplate ? 'tmp' : 'msg';
      const transformedData = scope[transformedVarName];

      if (transformedData !== undefined && transformedData !== null) {
        let transformedString: string;
        if (
          typeof transformedData === 'object' &&
          typeof (transformedData as any).toXMLString === 'function'
        ) {
          // XML object — call toXMLString() (Java: Context.toString handles this)
          transformedString = (transformedData as any).toXMLString();
        } else if (typeof transformedData === 'object' || Array.isArray(transformedData)) {
          // Object/Array — JSON.stringify (Java: NativeJSON.stringify)
          transformedString = JSON.stringify(transformedData);
        } else {
          // Primitive (string, number, etc.) — String() conversion
          transformedString = String(transformedData);
        }
        connectorMessage.setTransformedData(transformedString);
      }
    }

    return result;
  }

  /**
   * Execute a filter script (filter rules only)
   */
  executeFilter(
    filterRules: FilterRule[],
    connectorMessage: ConnectorMessage,
    rawContent: string,
    inboundType: SerializationType,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): FilterResult {
    const result = this.executeFilterTransformer(
      filterRules,
      [], // No transformer steps
      connectorMessage,
      rawContent,
      '', // No template
      inboundType,
      inboundType,
      scriptContext,
      options
    );

    return {
      accepted: result.success && result.result === true,
      error: result.error,
    };
  }

  /**
   * Execute a transformer script (transformer steps only)
   */
  executeTransformer(
    transformerSteps: TransformerStep[],
    connectorMessage: ConnectorMessage,
    rawContent: string,
    template: string,
    inboundType: SerializationType,
    outboundType: SerializationType,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): TransformerResult {
    // Use filter/transformer with empty filter (accepts all)
    const result = this.executeFilterTransformer(
      [], // No filter rules - accepts all
      transformerSteps,
      connectorMessage,
      rawContent,
      template,
      inboundType,
      outboundType,
      scriptContext,
      options
    );

    return {
      transformed: result.success,
      error: result.error,
    };
  }

  /**
   * Execute a response transformer script
   *
   * JRC-ECL-002 / JRC-SBD-020: Java's JavaScriptResponseTransformer.doTransform() reads
   * back three scope variables after execution to update the Response object:
   *   - responseStatus → response.setStatus()
   *   - responseStatusMessage → response.setStatusMessage()
   *   - responseErrorMessage → response.setError()
   * It also reads back transformed data (msg or tmp) via getTransformedDataFromScope().
   *
   * Java ref: JavaScriptResponseTransformer.java:197-200
   * Java ref: JavaScriptScopeUtil.getResponseDataFromScope():417-434
   */
  executeResponseTransformer(
    transformerSteps: TransformerStep[],
    connectorMessage: ConnectorMessage,
    response: Response,
    template: string,
    inboundType: SerializationType,
    outboundType: SerializationType,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): ExecutionResult<string> {
    const timeout = options.timeout ?? this.defaultTimeout;

    // Build scope (injects response, responseStatus, responseStatusMessage, responseErrorMessage)
    const scope = buildResponseTransformerScope(
      scriptContext,
      connectorMessage,
      response,
      template || undefined
    );

    // Generate script (no filter rules — response transformers have only transformer steps)
    const generatedScript = this.scriptBuilder.generateResponseTransformerScript(
      transformerSteps,
      inboundType,
      outboundType,
      !!template
    );

    // Create context and execute
    const context = this.createContext(scope);
    const result = this.executeScript<unknown>(generatedScript, context, timeout);

    if (result.success) {
      // Sync maps back to connector message
      syncMapsToConnectorMessage(scope, connectorMessage);

      // Read back response data from scope (Java: getResponseDataFromScope)
      const scopeStatus = scope['responseStatus'];
      const scopeStatusMessage = scope['responseStatusMessage'];
      const scopeErrorMessage = scope['responseErrorMessage'];

      if (scopeStatus !== undefined) {
        response.setStatus(scopeStatus as Status);
      }
      if (scopeStatusMessage !== undefined) {
        response.setStatusMessage(scopeStatusMessage === null ? '' : String(scopeStatusMessage));
      } else {
        response.setStatusMessage('');
      }
      if (scopeErrorMessage !== undefined) {
        response.setError(scopeErrorMessage === null ? '' : String(scopeErrorMessage));
      } else {
        response.setError('');
      }

      // Read back transformed data from scope (Java: getTransformedDataFromScope)
      const hasTemplate = !!template;
      const transformedVarName = hasTemplate ? 'tmp' : 'msg';
      const transformedData = scope[transformedVarName];

      let transformedString: string = '';
      if (transformedData !== undefined && transformedData !== null) {
        if (
          typeof transformedData === 'object' &&
          typeof (transformedData as any).toXMLString === 'function'
        ) {
          transformedString = (transformedData as any).toXMLString();
        } else if (typeof transformedData === 'object' || Array.isArray(transformedData)) {
          transformedString = JSON.stringify(transformedData);
        } else {
          transformedString = String(transformedData);
        }
      }

      return { ...result, result: transformedString };
    }

    return { ...result, result: undefined } as ExecutionResult<string>;
  }

  /**
   * Execute a preprocessor script
   */
  executePreprocessor(
    userScript: string,
    rawMessage: string,
    connectorMessage: ConnectorMessage,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): ExecutionResult<string> {
    const timeout = options.timeout ?? this.defaultTimeout;

    // Build scope
    const scope = buildPreprocessorScope(scriptContext, rawMessage, connectorMessage);

    // Generate script
    const generatedScript = this.scriptBuilder.generatePreprocessorScript(userScript);

    // Create context and execute
    const context = this.createContext(scope);
    const result = this.executeScript<string>(generatedScript, context, timeout);

    // The preprocessor script should return the modified message
    // If no return value, use the original message
    if (result.success) {
      // Get the 'message' variable from context - it may have been modified
      const modifiedMessage = context.message as string;
      return {
        ...result,
        result: modifiedMessage ?? rawMessage,
      };
    }

    return result;
  }

  /**
   * Execute a postprocessor script
   *
   * JRC-SBD-013: Java's executePostprocessorScripts() converts the script's return value
   * into a Response object via getPostprocessorResponse(). If the return value is a Response,
   * it's used directly. If it's any other non-null value, a new Response(SENT, value) is created.
   */
  executePostprocessor(
    userScript: string,
    message: Message,
    scriptContext: ScriptContext,
    response?: Response,
    options: ExecutionOptions = {}
  ): ExecutionResult<Response | undefined> {
    const timeout = options.timeout ?? this.defaultTimeout;

    // Build scope (pass optional response from channel postprocessor for global postprocessor)
    const scope = buildPostprocessorScope(scriptContext, message, response);

    // Generate script
    const generatedScript = this.scriptBuilder.generatePostprocessorScript(userScript);

    // Create context and execute
    const context = this.createContext(scope);
    const result = this.executeScript<unknown>(generatedScript, context, timeout);

    // Sync channelMap from merged scope back to source message.
    // The scope was built with getMergedConnectorMessage() which creates a copy —
    // $c() writes in the postprocessor go to the copy's channelMap. Without this
    // sync, those writes would be discarded when the scope is garbage collected.
    if (result.success) {
      const sourceMsg = message.getSourceConnectorMessage();
      const scopeChannelMap = scope.channelMap;
      // MirthMap is NOT a JS Map subclass — it wraps Map in this.data and exposes
      // keySet()/get()/put() instead of native Map methods like forEach/entries.
      if (sourceMsg && scopeChannelMap != null && typeof (scopeChannelMap as Record<string, unknown>).keySet === 'function') {
        const mirthMap = scopeChannelMap as { keySet: () => string[]; get: (k: string) => unknown };
        const keys = mirthMap.keySet();
        for (const key of keys) {
          sourceMsg.getChannelMap().set(key, mirthMap.get(key));
        }
      }
    }

    // Convert return value to Response (Java: getPostprocessorResponse)
    if (result.success && result.result != null) {
      if (result.result instanceof Response) {
        return { ...result, result: result.result };
      } else {
        // Any non-null return → Response(SENT, value.toString())
        return {
          ...result,
          result: new Response({ status: Status.SENT, message: String(result.result) }),
        };
      }
    }

    return { ...result, result: undefined };
  }

  /**
   * Execute global + channel preprocessor scripts in sequence (JRC-SBD-015)
   *
   * Ported from: JavaScriptUtil.executePreprocessorScripts() (lines 168-235)
   *
   * Flow:
   * 1. Execute global preprocessor with the raw message as input
   * 2. If global preprocessor succeeds and returns a result, use that as input to channel preprocessor
   * 3. Execute channel preprocessor with the (possibly modified) message
   *
   * If only one script is provided, it runs alone. If both are null/empty, returns the raw message unchanged.
   * If the global preprocessor errors, the error propagates immediately (channel preprocessor is not run).
   */
  executePreprocessorScripts(
    channelScript: string | null,
    globalScript: string | null,
    rawMessage: string,
    connectorMessage: ConnectorMessage,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): ExecutionResult<string> {
    const startTime = Date.now();
    let currentMessage = rawMessage;

    // 1. Execute global preprocessor first (if provided)
    if (globalScript && globalScript.trim()) {
      const globalResult = this.executePreprocessor(
        globalScript,
        currentMessage,
        connectorMessage,
        scriptContext,
        options
      );
      if (!globalResult.success) {
        return globalResult; // Propagate error — channel preprocessor is not run
      }
      if (globalResult.result) {
        currentMessage = globalResult.result;
      }
    }

    // 2. Execute channel preprocessor with global result as input
    if (channelScript && channelScript.trim()) {
      return this.executePreprocessor(
        channelScript,
        currentMessage,
        connectorMessage,
        scriptContext,
        options
      );
    }

    return { success: true, result: currentMessage, executionTime: Date.now() - startTime };
  }

  /**
   * Execute channel + global postprocessor scripts in sequence (JRC-SBD-015)
   *
   * Ported from: JavaScriptUtil.executePostprocessorScripts() (lines 260-303)
   *
   * Flow:
   * 1. Execute channel postprocessor first — may return a Response
   * 2. Execute global postprocessor with the channel's Response injected into scope
   *
   * If only one script is provided, it runs alone. If both are null/empty, returns success with no result.
   * If the channel postprocessor errors, the error propagates immediately (global postprocessor is not run).
   */
  executePostprocessorScripts(
    channelScript: string | null,
    globalScript: string | null,
    message: Message,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): ExecutionResult<Response | undefined> {
    const startTime = Date.now();
    let channelResponse: Response | undefined;

    // 1. Execute channel postprocessor first
    if (channelScript && channelScript.trim()) {
      const channelResult = this.executePostprocessor(
        channelScript,
        message,
        scriptContext,
        undefined,
        options
      );
      if (!channelResult.success) {
        return channelResult; // Propagate error — global postprocessor is not run
      }
      channelResponse = channelResult.result;
    }

    // 2. Execute global postprocessor with channel response
    if (globalScript && globalScript.trim()) {
      return this.executePostprocessor(
        globalScript,
        message,
        scriptContext,
        channelResponse,
        options
      );
    }

    return { success: true, result: channelResponse, executionTime: Date.now() - startTime };
  }

  /**
   * Execute a deploy script
   */
  executeDeploy(
    userScript: string,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): ExecutionResult<void> {
    const timeout = options.timeout ?? this.defaultTimeout;

    // Build scope
    const scope = buildDeployScope(scriptContext);

    // Generate script
    const generatedScript = this.scriptBuilder.generateDeployScript(userScript);

    // Create context and execute
    const context = this.createContext(scope);
    return this.executeScript<void>(generatedScript, context, timeout);
  }

  /**
   * Execute an undeploy script
   */
  executeUndeploy(
    userScript: string,
    scriptContext: ScriptContext,
    options: ExecutionOptions = {}
  ): ExecutionResult<void> {
    const timeout = options.timeout ?? this.defaultTimeout;

    // Build scope
    const scope = buildDeployScope(scriptContext);

    // Generate script
    const generatedScript = this.scriptBuilder.generateUndeployScript(userScript);

    // Create context and execute
    const context = this.createContext(scope);
    return this.executeScript<void>(generatedScript, context, timeout);
  }

  /**
   * Execute a script with custom scope
   */
  executeWithScope<T>(
    userScript: string,
    scope: Scope,
    options: ExecutionOptions = {}
  ): ExecutionResult<T> {
    const timeout = options.timeout ?? this.defaultTimeout;

    // Generate script
    const generatedScript = this.scriptBuilder.generateScript(userScript);

    // Merge with basic scope to ensure XMLProxy and other essentials are available
    const mergedScope = { ...buildBasicScope(), ...scope };

    // Create context and execute
    const context = this.createContext(mergedScope);
    return this.executeScript<T>(generatedScript, context, timeout);
  }

  /**
   * Execute raw JavaScript (no wrapping, minimal setup)
   */
  executeRaw<T>(
    script: string,
    scope: Scope = {},
    options: ExecutionOptions = {}
  ): ExecutionResult<T> {
    const timeout = options.timeout ?? this.defaultTimeout;
    // Merge with basic scope to ensure XMLProxy and other essentials are available
    const mergedScope = { ...buildBasicScope(), ...scope };
    const context = this.createContext(mergedScope);
    return this.executeScript<T>(script, context, timeout);
  }
}

/**
 * Convenience function to create an executor
 */
export function createJavaScriptExecutor(options?: ScriptOptions): JavaScriptExecutor {
  const executor = new JavaScriptExecutor(options);
  executor.initialize();
  return executor;
}

/**
 * Default executor instance
 */
let defaultExecutor: JavaScriptExecutor | null = null;

export function getDefaultExecutor(): JavaScriptExecutor {
  if (!defaultExecutor) {
    defaultExecutor = createJavaScriptExecutor();
  }
  return defaultExecutor;
}

/**
 * Reset default executor (for testing)
 */
export function resetDefaultExecutor(): void {
  defaultExecutor = null;
}

/**
 * Initialize the default executor (called during engine startup)
 */
export function initializeExecutor(): void {
  if (!defaultExecutor) {
    defaultExecutor = createJavaScriptExecutor();
  }
}
