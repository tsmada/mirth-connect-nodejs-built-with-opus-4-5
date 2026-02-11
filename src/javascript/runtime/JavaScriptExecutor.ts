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
    this.defaultTimeout = 30000;
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

      return {
        success: true,
        result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
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
        if (typeof transformedData === 'object' && typeof (transformedData as any).toXMLString === 'function') {
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
