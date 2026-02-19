/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/AuthenticatorProviderFactory.java
 *
 * Purpose: Factory for creating HTTP authenticator instances based on auth type.
 *
 * Java: AuthenticatorProviderFactory.getAuthenticatorProvider() switches on AuthType
 * and returns the appropriate AuthenticatorProvider subclass.
 *
 * Node.js simplification: We skip the Provider indirection layer (Java needs it
 * for lifecycle management + connector reference passing) and directly create
 * the Authenticator instance.
 */

export {
  AuthStatus,
  AuthType,
  AuthenticationResult,
  type BasicAuthProperties,
  type CredentialsResolver,
  DigestAlgorithm,
  type DigestAuthProperties,
  DigestQOPMode,
  type HttpAuthProperties,
  type HttpAuthenticator,
  type JavaScriptAuthProperties,
  type RequestInfo,
  getDefaultBasicAuthProperties,
  getDefaultDigestAuthProperties,
} from './types.js';

export { BasicAuthenticator } from './BasicAuthenticator.js';
export { DigestAuthenticator } from './DigestAuthenticator.js';
export { JavaScriptAuthenticator } from './JavaScriptAuthenticator.js';

import { AuthType, type HttpAuthProperties, type HttpAuthenticator } from './types.js';
import { BasicAuthenticator } from './BasicAuthenticator.js';
import { DigestAuthenticator } from './DigestAuthenticator.js';
import { JavaScriptAuthenticator } from './JavaScriptAuthenticator.js';

/**
 * Create an authenticator from auth properties.
 *
 * Java: AuthenticatorProviderFactory.getAuthenticatorProvider(connector, properties)
 *
 * @param properties - Authentication configuration (type determines which authenticator)
 * @returns HttpAuthenticator instance, or null for AuthType.NONE
 * @throws Error if auth type is not supported
 */
export function createAuthenticator(properties: HttpAuthProperties): HttpAuthenticator {
  switch (properties.authType) {
    case AuthType.BASIC:
      return new BasicAuthenticator(properties);
    case AuthType.DIGEST:
      return new DigestAuthenticator(properties);
    case AuthType.JAVASCRIPT:
      return new JavaScriptAuthenticator(properties);
    default:
      throw new Error(
        `Unsupported authentication type: ${(properties as { authType: string }).authType}`
      );
  }
}
