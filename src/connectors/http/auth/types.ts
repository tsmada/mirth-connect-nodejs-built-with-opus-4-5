/**
 * Ported from:
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/userutil/AuthStatus.java
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/AuthenticationResult.java
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/Authenticator.java
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/AuthenticatorProvider.java
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/HttpAuthConnectorPluginProperties.java
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/RequestInfo.java
 *
 * Purpose: HTTP authentication types matching Java Mirth's AuthenticatorProvider system.
 *
 * Key behaviors:
 * - AuthStatus enum: CHALLENGED, SUCCESS, FAILURE (matches Java exactly)
 * - AuthenticationResult: status + username + realm + response headers
 * - HttpAuthenticator: abstract interface for authentication implementations
 * - RequestInfo: request metadata passed to authenticators
 * - AuthType: NONE, BASIC, DIGEST, JAVASCRIPT, CUSTOM, OAUTH2_VERIFICATION
 */

/**
 * Authentication attempt result status.
 *
 * Java: com.mirth.connect.plugins.httpauth.userutil.AuthStatus
 */
export enum AuthStatus {
  /** Request should be rejected with an authentication challenge. */
  CHALLENGED = 'CHALLENGED',
  /** Request should be accepted. */
  SUCCESS = 'SUCCESS',
  /** Request should be rejected without a challenge. */
  FAILURE = 'FAILURE',
}

/**
 * Authentication type for HTTP receiver.
 *
 * Java: HttpAuthConnectorPluginProperties.AuthType
 */
export enum AuthType {
  NONE = 'None',
  BASIC = 'Basic',
  DIGEST = 'Digest',
  JAVASCRIPT = 'JavaScript',
  CUSTOM = 'Custom',
  OAUTH2_VERIFICATION = 'OAuth 2.0 Token Verification',
}

/**
 * Request information passed to authenticators.
 *
 * Java: com.mirth.connect.plugins.httpauth.RequestInfo
 */
export interface RequestInfo {
  remoteAddress: string;
  remotePort: number;
  localAddress: string;
  localPort: number;
  protocol: string;
  method: string;
  requestURI: string;
  headers: Map<string, string[]>;
  queryParameters: Map<string, string[]>;
  /** Provides the raw request body bytes (lazily loaded). */
  getEntity: () => Buffer;
}

/**
 * Result of an HTTP authentication attempt.
 *
 * Java: com.mirth.connect.plugins.httpauth.AuthenticationResult
 *
 * The responseHeaders map supports multi-value headers (e.g., multiple
 * WWW-Authenticate headers). Java uses LinkedHashMap<String, List<String>>.
 */
export class AuthenticationResult {
  status: AuthStatus;
  username: string;
  realm: string;
  responseHeaders: Map<string, string[]>;

  constructor(status: AuthStatus) {
    this.status = status;
    this.username = '';
    this.realm = '';
    this.responseHeaders = new Map();
  }

  /**
   * Add a response header value. Supports multi-value headers.
   */
  addResponseHeader(key: string, value: string): void {
    const existing = this.responseHeaders.get(key);
    if (existing) {
      existing.push(value);
    } else {
      this.responseHeaders.set(key, [value]);
    }
  }

  /**
   * Create a CHALLENGED result with WWW-Authenticate header.
   *
   * Java: AuthenticationResult.Challenged(authenticateHeader)
   */
  static Challenged(authenticateHeader: string): AuthenticationResult {
    const result = new AuthenticationResult(AuthStatus.CHALLENGED);
    result.addResponseHeader('WWW-Authenticate', (authenticateHeader ?? '').trim());
    return result;
  }

  /**
   * Create a SUCCESS result with no credentials info.
   *
   * Java: AuthenticationResult.Success()
   */
  static Success(): AuthenticationResult;
  /**
   * Create a SUCCESS result with username and realm.
   *
   * Java: AuthenticationResult.Success(username, realm)
   */
  static Success(username: string, realm: string): AuthenticationResult;
  static Success(username?: string, realm?: string): AuthenticationResult {
    const result = new AuthenticationResult(AuthStatus.SUCCESS);
    if (username !== undefined) {
      result.username = (username ?? '').trim();
    }
    if (realm !== undefined) {
      result.realm = (realm ?? '').trim();
    }
    return result;
  }

  /**
   * Create a FAILURE result.
   *
   * Java: AuthenticationResult.Failure()
   */
  static Failure(): AuthenticationResult {
    return new AuthenticationResult(AuthStatus.FAILURE);
  }
}

/**
 * Abstract authenticator interface.
 *
 * Java: com.mirth.connect.plugins.httpauth.Authenticator
 *
 * Implementations: BasicAuthenticator, DigestAuthenticator, JavaScriptAuthenticator
 */
export interface HttpAuthenticator {
  /**
   * Authenticate a request.
   *
   * Returns AuthenticationResult with:
   * - SUCCESS: request accepted, continue processing
   * - CHALLENGED: send 401 with response headers (e.g., WWW-Authenticate)
   * - FAILURE: send 401 without challenge
   */
  authenticate(
    request: RequestInfo,
    credentialsResolver?: CredentialsResolver
  ): Promise<AuthenticationResult>;

  /**
   * Called when the authenticator provider is being shut down (e.g., on channel undeploy).
   * Optional cleanup method.
   */
  shutdown?(): void;
}

/**
 * Configuration for Basic authentication.
 *
 * Java: com.mirth.connect.plugins.httpauth.basic.BasicHttpAuthProperties
 */
export interface BasicAuthProperties {
  authType: AuthType.BASIC;
  realm: string;
  /** Static credentials map: username -> password */
  credentials: Map<string, string>;
  /** Use a variable to look up credentials at runtime */
  useCredentialsVariable: boolean;
  /** Variable name for runtime credential lookup */
  credentialsVariable: string;
}

/**
 * Digest auth algorithm.
 *
 * Java: DigestHttpAuthProperties.Algorithm
 */
export enum DigestAlgorithm {
  MD5 = 'MD5',
  MD5_SESS = 'MD5-sess',
}

/**
 * Digest auth Quality of Protection mode.
 *
 * Java: DigestHttpAuthProperties.QOPMode
 */
export enum DigestQOPMode {
  AUTH = 'auth',
  AUTH_INT = 'auth-int',
}

/**
 * Configuration for Digest authentication.
 *
 * Java: com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties
 */
export interface DigestAuthProperties {
  authType: AuthType.DIGEST;
  realm: string;
  algorithms: Set<DigestAlgorithm>;
  qopModes: Set<DigestQOPMode>;
  opaque: string;
  /** Static credentials map: username -> password */
  credentials: Map<string, string>;
  /** Use a variable to look up credentials at runtime */
  useCredentialsVariable: boolean;
  /** Variable name for runtime credential lookup */
  credentialsVariable: string;
}

/**
 * Configuration for JavaScript authentication.
 *
 * Java: com.mirth.connect.plugins.httpauth.javascript.JavaScriptHttpAuthProperties
 */
export interface JavaScriptAuthProperties {
  authType: AuthType.JAVASCRIPT;
  /** User script that returns AuthenticationResult or boolean. */
  script: string;
}

/**
 * Function that resolves credentials from message context at runtime.
 * Used when useCredentialsVariable is true.
 * Returns a Map<string, string> (username -> password).
 *
 * Java: BasicAuthenticator/DigestAuthenticator call MessageMaps.get(variableName)
 * which looks up the variable from channelMap -> sourceMap -> connectorMap.
 */
export type CredentialsResolver = (variableName: string) => Map<string, string> | undefined;

/**
 * Union of all authentication property types.
 */
export type HttpAuthProperties =
  | BasicAuthProperties
  | DigestAuthProperties
  | JavaScriptAuthProperties;

/**
 * Default Basic auth properties.
 */
export function getDefaultBasicAuthProperties(): BasicAuthProperties {
  return {
    authType: AuthType.BASIC,
    realm: 'My Realm',
    credentials: new Map(),
    useCredentialsVariable: false,
    credentialsVariable: '',
  };
}

/**
 * Default Digest auth properties.
 */
export function getDefaultDigestAuthProperties(): DigestAuthProperties {
  return {
    authType: AuthType.DIGEST,
    realm: 'My Realm',
    algorithms: new Set([DigestAlgorithm.MD5, DigestAlgorithm.MD5_SESS]),
    qopModes: new Set([DigestQOPMode.AUTH, DigestQOPMode.AUTH_INT]),
    opaque: '',
    credentials: new Map(),
    useCredentialsVariable: false,
    credentialsVariable: '',
  };
}
