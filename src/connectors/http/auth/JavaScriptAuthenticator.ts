/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/javascript/JavaScriptAuthenticator.java
 *
 * Purpose: JavaScript-based custom authentication for HTTP Receiver.
 *
 * Key behaviors to replicate:
 * - Execute a user-provided script to determine authentication
 * - Script has access to sourceMap with request info (headers, parameters, etc.)
 * - Script has access to AuthStatus enum values (CHALLENGED, SUCCESS, FAILURE)
 * - Script can return:
 *   - AuthenticationResult object directly
 *   - boolean true for SUCCESS, false/undefined for FAILURE
 * - Uses the E4X transpiler for script preprocessing
 * - Uses the sandboxed VM for execution
 */

import * as vm from 'vm';

import {
  AuthenticationResult,
  AuthStatus,
  HttpAuthenticator,
  JavaScriptAuthProperties,
  RequestInfo,
} from './types.js';

export class JavaScriptAuthenticator implements HttpAuthenticator {
  private properties: JavaScriptAuthProperties;
  private compiledScript: vm.Script | null = null;

  constructor(properties: JavaScriptAuthProperties) {
    this.properties = properties;
  }

  async authenticate(request: RequestInfo): Promise<AuthenticationResult> {
    // Build sourceMap from request info
    const sourceMap = new Map<string, unknown>();
    sourceMap.set('remoteAddress', request.remoteAddress);
    sourceMap.set('remotePort', request.remotePort);
    sourceMap.set('localAddress', request.localAddress);
    sourceMap.set('localPort', request.localPort);
    sourceMap.set('protocol', request.protocol);
    sourceMap.set('method', request.method);
    sourceMap.set('uri', request.requestURI);
    sourceMap.set('headers', request.headers);
    sourceMap.set('parameters', request.queryParameters);

    // Build the scope for the script
    const scope: Record<string, unknown> = {
      sourceMap,
      // Expose AuthStatus enum values as top-level variables (matches Java)
      CHALLENGED: AuthStatus.CHALLENGED,
      SUCCESS: AuthStatus.SUCCESS,
      FAILURE: AuthStatus.FAILURE,
      // Expose AuthenticationResult class for direct construction
      AuthenticationResult,
      AuthStatus,
      // Disable timers for sandbox safety
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      queueMicrotask: undefined,
    };

    const context = vm.createContext(scope);

    // Compile the script (lazy, cached)
    if (!this.compiledScript) {
      try {
        this.compiledScript = new vm.Script(this.properties.script, {
          filename: 'http-auth-script.js',
        });
      } catch (e) {
        // Script compilation error — fail authentication
        return AuthenticationResult.Failure();
      }
    }

    try {
      const result = this.compiledScript.runInContext(context, { timeout: 10000 });

      if (result != null) {
        if (result instanceof AuthenticationResult) {
          return result;
        } else if (typeof result === 'boolean') {
          return result ? AuthenticationResult.Success() : AuthenticationResult.Failure();
        } else if (typeof result === 'object' && result.status) {
          // Object with status field — treat as AuthenticationResult-like
          const authResult = new AuthenticationResult(result.status);
          if (result.username) authResult.username = String(result.username);
          if (result.realm) authResult.realm = String(result.realm);
          return authResult;
        }
      }
    } catch (_e) {
      // Script execution error — fail authentication
    }

    return AuthenticationResult.Failure();
  }

  shutdown(): void {
    this.compiledScript = null;
  }
}
