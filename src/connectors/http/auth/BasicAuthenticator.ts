/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/basic/BasicAuthenticator.java
 *
 * Purpose: HTTP Basic Authentication (RFC 7617) for HTTP Receiver source connector.
 *
 * Key behaviors to replicate:
 * - Parse Authorization: Basic base64(user:pass) header
 * - Verify against static credentials map or runtime variable
 * - Return CHALLENGED with WWW-Authenticate: Basic realm="..." if no/bad credentials
 * - Return SUCCESS with username and realm on valid credentials
 * - Credentials map supports multiple users (username -> password)
 * - ISO-8859-1 encoding for base64 decode (matches Java's StandardCharsets.ISO_8859_1)
 */

import {
  AuthenticationResult,
  type BasicAuthProperties,
  type CredentialsResolver,
  type HttpAuthenticator,
  type RequestInfo,
} from './types.js';

export class BasicAuthenticator implements HttpAuthenticator {
  private properties: BasicAuthProperties;

  constructor(properties: BasicAuthProperties) {
    this.properties = properties;
  }

  async authenticate(
    request: RequestInfo,
    credentialsResolver?: CredentialsResolver
  ): Promise<AuthenticationResult> {
    const authHeaderList = request.headers.get('authorization');

    if (authHeaderList && authHeaderList.length > 0) {
      const authHeader = (authHeaderList[0] ?? '').trim();

      const spaceIndex = authHeader.indexOf(' ');
      if (spaceIndex > 0) {
        const method = authHeader.substring(0, spaceIndex);

        if (method.toLowerCase() === 'basic') {
          // Get Base64-encoded credentials
          const base64Credentials = authHeader.substring(spaceIndex).trim();

          // Decode using latin1 (ISO-8859-1) to match Java's StandardCharsets.ISO_8859_1
          const credentials = Buffer.from(base64Credentials, 'base64').toString('latin1');

          // Split on ':' to get username and password
          const colonIndex = credentials.indexOf(':');
          if (colonIndex > 0) {
            const username = credentials.substring(0, colonIndex);
            const password = credentials.substring(colonIndex + 1);

            const credentialsSource = this.getCredentials(credentialsResolver);

            // Return successful result if the passwords match
            if (credentialsSource.get(username) === password) {
              return AuthenticationResult.Success(username, this.properties.realm);
            }
          }
        }
      }
    }

    // Return authentication challenge
    return AuthenticationResult.Challenged(`Basic realm="${this.properties.realm}"`);
  }

  /**
   * Get the credentials map, supporting both static and runtime variable sources.
   *
   * Java: BasicAuthenticator.getCredentials() checks useCredentialsVariable and
   * if true, resolves the variable from MessageMaps. Falls back to static credentials
   * if the variable is not found or returns empty.
   */
  private getCredentials(credentialsResolver?: CredentialsResolver): Map<string, string> {
    if (this.properties.useCredentialsVariable && credentialsResolver) {
      const resolved = credentialsResolver(this.properties.credentialsVariable);
      if (resolved && resolved.size > 0) {
        return resolved;
      }
    }
    return this.properties.credentials;
  }
}
