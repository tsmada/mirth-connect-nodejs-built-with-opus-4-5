/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/httpauth/digest/DigestAuthenticator.java
 *
 * Purpose: HTTP Digest Authentication (RFC 7616) for HTTP Receiver source connector.
 *
 * Key behaviors to replicate:
 * - Full RFC 7616 Digest challenge-response authentication
 * - MD5 and MD5-sess algorithm support
 * - QOP modes: auth and auth-int
 * - Server-side nonce generation, expiry, and replay protection
 * - Nonce count (nc) validation to prevent replay attacks
 * - Stale nonce detection and re-challenge
 * - Opaque value pass-through
 * - Nonce expiry after 60 seconds (MAX_NONCE_AGE)
 * - Max nonce count of 1024 (MAX_NONCE_COUNT)
 *
 * Uses Node.js built-in crypto module (no new dependencies).
 */

import { createHash, randomBytes } from 'crypto';

import {
  AuthenticationResult,
  type CredentialsResolver,
  DigestAlgorithm,
  DigestAuthProperties,
  DigestQOPMode,
  HttpAuthenticator,
  RequestInfo,
} from './types.js';

/** Maximum nonce age in milliseconds (60 seconds — Java uses 60s in nanos). */
const MAX_NONCE_AGE_MS = 60 * 1000;

/** Maximum nonce count before it's considered stale. */
const MAX_NONCE_COUNT = 1024;

/** Internal status for tracking digest validation state. */
enum DigestStatus {
  VALID = 'VALID',
  INVALID = 'INVALID',
  STALE = 'STALE',
}

/** Server-side nonce with expiry and count tracking. */
class Nonce {
  readonly value: string;
  readonly opaque: string;
  private readonly created: number;
  private count: number;

  constructor(opaque: string) {
    this.opaque = (opaque ?? '').trim();
    // Generate 24 random bytes, base64 encode (matches Java's SecureRandom + Base64)
    this.value = randomBytes(24).toString('base64');
    this.created = Date.now();
    this.count = 0;
  }

  isExpired(): boolean {
    return Date.now() - this.created > MAX_NONCE_AGE_MS;
  }

  incrementCount(): DigestStatus {
    this.count++;
    return this.count <= MAX_NONCE_COUNT ? DigestStatus.VALID : DigestStatus.STALE;
  }

  updateCount(count: number): DigestStatus {
    if (count <= this.count) {
      return DigestStatus.INVALID;
    }
    this.count = count;
    if (this.count > MAX_NONCE_COUNT) {
      return DigestStatus.STALE;
    }
    return DigestStatus.VALID;
  }
}

/**
 * Parse the Authorization: Digest header into name-value directives.
 *
 * Java: Uses QuotedStringTokenizer to split on "=, " with quote handling.
 * We replicate the same parsing logic.
 */
function parseDigestDirectives(authHeader: string): Map<string, string> {
  const directives = new Map<string, string>();

  // Remove "Digest " prefix
  const prefixIndex = authHeader.indexOf(' ');
  if (prefixIndex < 0) return directives;
  const directiveStr = authHeader.substring(prefixIndex + 1);

  // Parse key="value" or key=value pairs separated by commas
  // This regex handles both quoted and unquoted values
  // Unquoted values can contain alphanumeric, +, /, =, -, . (e.g., "auth-int", "MD5-sess")
  const regex = /(\w+)=(?:"([^"]*)"|([\w+/=.-]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(directiveStr)) !== null) {
    const key = match[1]!;
    const value = match[2] ?? match[3] ?? '';
    directives.set(key.toLowerCase(), value);
  }

  return directives;
}

/**
 * Compute MD5 digest of colon-separated parts.
 *
 * Java: DigestAuthenticator.digest(Object... parts) — joins with ':' and hashes with MD5.
 * Returns lowercase hex string.
 */
function md5Digest(...parts: (string | Buffer)[]): string {
  const hash = createHash('md5');

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (Buffer.isBuffer(part)) {
      hash.update(part);
    } else {
      // Use latin1 (ISO-8859-1) encoding to match Java's StandardCharsets.ISO_8859_1
      hash.update(part, 'latin1');
    }
    if (i < parts.length - 1) {
      hash.update(':');
    }
  }

  return hash.digest('hex');
}

export class DigestAuthenticator implements HttpAuthenticator {
  private properties: DigestAuthProperties;
  private nonceMap: Map<string, Nonce> = new Map();

  constructor(properties: DigestAuthProperties) {
    this.properties = properties;
  }

  async authenticate(request: RequestInfo, credentialsResolver?: CredentialsResolver): Promise<AuthenticationResult> {
    const authHeaderList = request.headers.get('authorization');
    const directives = new Map<string, string>();
    let nonceString: string | undefined;
    let nonceCountString: string | undefined;
    let nonceOpaque = '';

    // This status determines whether to send back a challenge.
    // Also used to detect stale nonces.
    let status = DigestStatus.INVALID;

    if (authHeaderList && authHeaderList.length > 0) {
      const authHeader = authHeaderList[0] ?? '';

      // Parse directives from the Authorization header
      const parsed = parseDigestDirectives(authHeader);
      for (const [key, value] of parsed) {
        directives.set(key, value);
      }

      nonceString = directives.get('nonce');
      nonceCountString = directives.get('nc');

      // Authentication isn't valid without a nonce
      if (nonceString) {
        const nonce = this.nonceMap.get(nonceString);

        if (nonce) {
          nonceOpaque = nonce.opaque;

          if (nonce.isExpired()) {
            status = DigestStatus.STALE;
          } else if (nonceCountString) {
            // Nonce count supplied — validate it
            const parsedCount = parseInt(nonceCountString, 16);
            if (!isNaN(parsedCount)) {
              status = nonce.updateCount(parsedCount);
            }
            // If parsing fails, status remains INVALID
          } else {
            // No nonce count — just increment
            status = nonce.incrementCount();
          }
        } else {
          // Nonce not found (expired or never existed)
          status = DigestStatus.STALE;
        }
      }
    }

    // Remove expired nonces from cache
    this.cleanupNonces();

    // If status is VALID or STALE, attempt to calculate and verify the digest
    if (status !== DigestStatus.INVALID) {
      try {
        const username = directives.get('username');
        const realm = directives.get('realm');
        const uri = directives.get('uri');
        const response = directives.get('response');
        const clientNonce = directives.get('cnonce');
        const qop = directives.get('qop');
        const algorithm = directives.get('algorithm');
        const opaque = (directives.get('opaque') ?? '').trim();

        // Validate required directives
        if (!username) throw new Error('Username missing.');
        if (!realm) throw new Error('Realm missing.');
        if (uri === undefined) throw new Error('URI missing.');
        if (!response) throw new Error('Response digest missing.');

        let requestURI = request.requestURI;
        // Allow empty URI to match "/"
        if (!uri && requestURI === '/') {
          requestURI = '';
        }

        if (this.properties.realm.toLowerCase() !== realm.toLowerCase()) {
          throw new Error(`Realm "${realm}" does not match expected realm "${this.properties.realm}".`);
        }
        if (requestURI.toLowerCase() !== uri.toLowerCase()) {
          throw new Error(`URI "${uri}" does not match the request URI "${requestURI}".`);
        }
        if (opaque !== nonceOpaque) {
          throw new Error(`Opaque value "${opaque}" does not match expected value "${nonceOpaque}".`);
        }

        const credentialsSource = this.getCredentials(credentialsResolver);
        const password = credentialsSource.get(username);
        if (password === undefined) {
          throw new Error(`Credentials for username ${username} not found.`);
        }

        // Calculate H(A1)
        // Algorithm MD5: A1 = username:realm:password
        // Algorithm MD5-sess: A1 = H(username:realm:password):nonce:cnonce
        let ha1: string;

        if (
          !algorithm ||
          (algorithm.toUpperCase() === DigestAlgorithm.MD5 && this.properties.algorithms.has(DigestAlgorithm.MD5))
        ) {
          ha1 = md5Digest(username, realm, password);
        } else if (
          algorithm.toLowerCase() === 'md5-sess' &&
          this.properties.algorithms.has(DigestAlgorithm.MD5_SESS)
        ) {
          if (!clientNonce) throw new Error('Client nonce missing.');
          const credentialsDigest = md5Digest(username, realm, password);
          ha1 = md5Digest(credentialsDigest, nonceString!, clientNonce);
        } else {
          throw new Error(`Algorithm "${algorithm}" not supported.`);
        }

        // Calculate H(A2)
        // QOP undefined/auth: A2 = method:uri
        // QOP auth-int: A2 = method:uri:H(entityBody)
        let ha2: string;

        if (!qop || (qop.toLowerCase() === 'auth' && this.properties.qopModes.has(DigestQOPMode.AUTH))) {
          ha2 = md5Digest(request.method, uri);
        } else if (qop.toLowerCase() === 'auth-int' && this.properties.qopModes.has(DigestQOPMode.AUTH_INT)) {
          const entityBody = request.getEntity();
          const entityDigest = md5Digest(entityBody);
          ha2 = md5Digest(request.method, uri, entityDigest);
        } else {
          throw new Error(`Quality of protection mode "${qop}" not supported.`);
        }

        // Calculate response
        // QOP undefined: response = H(H(A1):nonce:H(A2))
        // QOP auth/auth-int: response = H(H(A1):nonce:nc:cnonce:qop:H(A2))
        let rsp: string;

        if (!qop) {
          rsp = md5Digest(ha1, nonceString!, ha2);
        } else {
          if (!nonceCountString) throw new Error('Nonce count missing.');
          if (!clientNonce) throw new Error('Client nonce missing.');
          rsp = md5Digest(ha1, nonceString!, nonceCountString, clientNonce, qop, ha2);
        }

        if (rsp.toLowerCase() === response.toLowerCase()) {
          // If status is VALID, return success. If STALE, re-challenge with stale=true.
          if (status === DigestStatus.VALID) {
            return AuthenticationResult.Success(username, realm);
          }
        } else {
          throw new Error(`Response digest "${response}" does not match expected digest "${rsp}".`);
        }
      } catch (_e) {
        // Any error in digest validation means the request is invalid
        status = DigestStatus.INVALID;
      }
    }

    // Send an authentication challenge with a new nonce
    const nonce = new Nonce(this.properties.opaque);
    this.nonceMap.set(nonce.value, nonce);

    // Extract context path from request URI
    let contextPath = '/';
    try {
      const url = new URL(request.requestURI, 'http://localhost');
      contextPath = url.pathname;
    } catch {
      // Keep default "/"
    }

    // Build the WWW-Authenticate: Digest ... header
    const parts: string[] = [];
    parts.push(`realm="${this.properties.realm}"`);
    parts.push(`domain="${contextPath}"`);
    parts.push(`nonce="${nonce.value}"`);

    const algorithms = [...this.properties.algorithms].join(',');
    parts.push(`algorithm="${algorithms}"`);

    if (this.properties.qopModes.size > 0) {
      const qopModes = [...this.properties.qopModes].join(',');
      parts.push(`qop="${qopModes}"`);
    }

    if (nonce.opaque) {
      parts.push(`opaque="${nonce.opaque}"`);
    }

    if (status === DigestStatus.STALE) {
      parts.push(`stale="true"`);
    }

    const authenticateHeader = `Digest ${parts.join(', ')}`;
    return AuthenticationResult.Challenged(authenticateHeader);
  }

  /**
   * Remove expired nonces from the cache.
   *
   * Java: DigestAuthenticator.cleanupNonces()
   */
  private cleanupNonces(): void {
    for (const [key, nonce] of this.nonceMap) {
      if (nonce.isExpired()) {
        this.nonceMap.delete(key);
      }
    }
  }

  /**
   * Get credentials map, supporting both static and runtime variable sources.
   *
   * Java: DigestAuthenticator.getCredentials() checks useCredentialsVariable and
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

  shutdown(): void {
    this.nonceMap.clear();
  }
}
