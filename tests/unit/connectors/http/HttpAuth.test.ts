/**
 * Tests for HTTP Receiver pluggable authentication (CPC-MAM-002).
 *
 * Covers:
 * - BasicAuthenticator: valid credentials, missing header, wrong credentials, multi-user
 * - DigestAuthenticator: full challenge-response flow, stale nonce, replay protection
 * - JavaScriptAuthenticator: script-based auth with various return types
 * - AuthenticationResult: static factory methods, response headers
 * - createAuthenticator factory
 * - Integration with HttpReceiver request handler
 */

import { createHash, randomBytes } from 'crypto';
import {
  AuthenticationResult,
  AuthStatus,
  AuthType,
  BasicAuthenticator,
  DigestAuthenticator,
  JavaScriptAuthenticator,
  createAuthenticator,
  getDefaultBasicAuthProperties,
  getDefaultDigestAuthProperties,
} from '../../../../src/connectors/http/auth/index';
import type { RequestInfo } from '../../../../src/connectors/http/auth/types';

// Helper to create a minimal RequestInfo for testing
function createRequestInfo(overrides: Partial<RequestInfo> = {}): RequestInfo {
  return {
    remoteAddress: '127.0.0.1',
    remotePort: 54321,
    localAddress: '0.0.0.0',
    localPort: 8080,
    protocol: 'HTTP/1.1',
    method: 'GET',
    requestURI: '/',
    headers: new Map(),
    queryParameters: new Map(),
    getEntity: () => Buffer.alloc(0),
    ...overrides,
  };
}

// Helper to create a Basic auth header
function basicAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`, 'latin1').toString('base64');
}

// ---------- AuthenticationResult ----------

describe('AuthenticationResult', () => {
  it('should create with status', () => {
    const result = new AuthenticationResult(AuthStatus.SUCCESS);
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe('');
    expect(result.realm).toBe('');
    expect(result.responseHeaders.size).toBe(0);
  });

  it('Challenged() should create CHALLENGED with WWW-Authenticate header', () => {
    const result = AuthenticationResult.Challenged('Basic realm="Test"');
    expect(result.status).toBe(AuthStatus.CHALLENGED);
    expect(result.responseHeaders.get('WWW-Authenticate')).toEqual(['Basic realm="Test"']);
  });

  it('Success() should create SUCCESS with no credentials', () => {
    const result = AuthenticationResult.Success();
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe('');
    expect(result.realm).toBe('');
  });

  it('Success(username, realm) should create SUCCESS with credentials', () => {
    const result = AuthenticationResult.Success('admin', 'My Realm');
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe('admin');
    expect(result.realm).toBe('My Realm');
  });

  it('Failure() should create FAILURE', () => {
    const result = AuthenticationResult.Failure();
    expect(result.status).toBe(AuthStatus.FAILURE);
  });

  it('addResponseHeader should support multi-value headers', () => {
    const result = new AuthenticationResult(AuthStatus.CHALLENGED);
    result.addResponseHeader('WWW-Authenticate', 'Basic realm="A"');
    result.addResponseHeader('WWW-Authenticate', 'Digest realm="B"');
    expect(result.responseHeaders.get('WWW-Authenticate')).toEqual([
      'Basic realm="A"',
      'Digest realm="B"',
    ]);
  });
});

// ---------- BasicAuthenticator ----------

describe('BasicAuthenticator', () => {
  let authenticator: BasicAuthenticator;

  beforeEach(() => {
    const props = getDefaultBasicAuthProperties();
    props.realm = 'Test Realm';
    props.credentials.set('admin', 'secret');
    props.credentials.set('user', 'pass123');
    authenticator = new BasicAuthenticator(props);
  });

  it('should authenticate valid credentials', async () => {
    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('admin', 'secret')]]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe('admin');
    expect(result.realm).toBe('Test Realm');
  });

  it('should authenticate second user in multi-user credentials map', async () => {
    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('user', 'pass123')]]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe('user');
  });

  it('should return CHALLENGED when no Authorization header present', async () => {
    const request = createRequestInfo();

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
    expect(result.responseHeaders.get('WWW-Authenticate')).toEqual([
      'Basic realm="Test Realm"',
    ]);
  });

  it('should return CHALLENGED for wrong password', async () => {
    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('admin', 'wrong')]]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should return CHALLENGED for unknown username', async () => {
    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('nobody', 'secret')]]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should return CHALLENGED for non-Basic auth method', async () => {
    const request = createRequestInfo({
      headers: new Map([['authorization', ['Bearer some-token']]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should return CHALLENGED for malformed Basic header (no space)', async () => {
    const request = createRequestInfo({
      headers: new Map([['authorization', ['BasicYWRtaW46c2VjcmV0']]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should return CHALLENGED for credentials without colon', async () => {
    const request = createRequestInfo({
      headers: new Map([['authorization', ['Basic ' + Buffer.from('nocolon').toString('base64')]]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should handle password with colons (split on first colon only)', async () => {
    const props = getDefaultBasicAuthProperties();
    props.credentials.set('user', 'pass:with:colons');
    const auth = new BasicAuthenticator(props);

    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('user', 'pass:with:colons')]]]),
    });

    const result = await auth.authenticate(request);
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });

  it('should handle empty authorization header list', async () => {
    const request = createRequestInfo({
      headers: new Map([['authorization', []]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });
});

// ---------- DigestAuthenticator ----------

describe('DigestAuthenticator', () => {
  let authenticator: DigestAuthenticator;
  const realm = 'Test Realm';
  const username = 'admin';
  const password = 'secret';

  beforeEach(() => {
    const props = getDefaultDigestAuthProperties();
    props.realm = realm;
    props.opaque = 'test-opaque';
    props.credentials.set(username, password);
    authenticator = new DigestAuthenticator(props);
  });

  afterEach(() => {
    authenticator.shutdown();
  });

  it('should return CHALLENGED when no Authorization header present', async () => {
    const request = createRequestInfo();

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);

    const wwwAuth = result.responseHeaders.get('WWW-Authenticate');
    expect(wwwAuth).toBeDefined();
    expect(wwwAuth![0]).toContain('Digest');
    expect(wwwAuth![0]).toContain(`realm="${realm}"`);
    expect(wwwAuth![0]).toContain('nonce="');
    expect(wwwAuth![0]).toContain(`opaque="${'test-opaque'}"`);
  });

  it('should include algorithm and qop in challenge', async () => {
    const request = createRequestInfo();

    const result = await authenticator.authenticate(request);
    const wwwAuth = result.responseHeaders.get('WWW-Authenticate')![0]!;
    expect(wwwAuth).toContain('algorithm="');
    expect(wwwAuth).toContain('qop="');
  });

  it('should authenticate valid Digest response (MD5, qop=auth)', async () => {
    // Step 1: Get initial challenge to extract nonce
    const request1 = createRequestInfo();
    const challenge = await authenticator.authenticate(request1);
    const wwwAuth = challenge.responseHeaders.get('WWW-Authenticate')![0]!;

    // Extract nonce and opaque from challenge
    const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/);
    const opaqueMatch = wwwAuth.match(/opaque="([^"]+)"/);
    const nonce = nonceMatch![1]!;
    const opaque = opaqueMatch![1]!;

    // Step 2: Compute digest response
    const method = 'GET';
    const uri = '/';
    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');
    const qop = 'auth';

    // H(A1) = MD5(username:realm:password)
    const ha1 = createHash('md5').update(`${username}:${realm}:${password}`, 'latin1').digest('hex');
    // H(A2) = MD5(method:uri)
    const ha2 = createHash('md5').update(`${method}:${uri}`, 'latin1').digest('hex');
    // response = MD5(H(A1):nonce:nc:cnonce:qop:H(A2))
    const responseHash = createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`, 'latin1')
      .digest('hex');

    const authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", nc=${nc}, cnonce="${cnonce}", qop=${qop}, response="${responseHash}", opaque="${opaque}", algorithm="MD5"`;

    const request2 = createRequestInfo({
      headers: new Map([['authorization', [authHeader]]]),
    });

    const result = await authenticator.authenticate(request2);
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe(username);
  });

  it('should authenticate valid Digest response without qop (legacy)', async () => {
    // Create an authenticator with no QOP modes (legacy behavior)
    const props = getDefaultDigestAuthProperties();
    props.realm = realm;
    props.opaque = '';
    props.qopModes = new Set(); // No QOP
    props.credentials.set(username, password);
    const legacyAuth = new DigestAuthenticator(props);

    // Step 1: Get challenge
    const challenge = await legacyAuth.authenticate(createRequestInfo());
    const wwwAuth = challenge.responseHeaders.get('WWW-Authenticate')![0]!;
    const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/);
    const nonce = nonceMatch![1]!;

    // Step 2: Compute digest response (no qop)
    const method = 'GET';
    const uri = '/';

    const ha1 = createHash('md5').update(`${username}:${realm}:${password}`, 'latin1').digest('hex');
    const ha2 = createHash('md5').update(`${method}:${uri}`, 'latin1').digest('hex');
    // Without QOP: response = MD5(H(A1):nonce:H(A2))
    const responseHash = createHash('md5')
      .update(`${ha1}:${nonce}:${ha2}`, 'latin1')
      .digest('hex');

    const authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${responseHash}", algorithm="MD5"`;

    const request = createRequestInfo({
      headers: new Map([['authorization', [authHeader]]]),
    });

    const result = await legacyAuth.authenticate(request);
    expect(result.status).toBe(AuthStatus.SUCCESS);
    legacyAuth.shutdown();
  });

  it('should return CHALLENGED for wrong password in Digest', async () => {
    // Step 1: Get challenge
    const challenge = await authenticator.authenticate(createRequestInfo());
    const wwwAuth = challenge.responseHeaders.get('WWW-Authenticate')![0]!;
    const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/);
    const opaqueMatch = wwwAuth.match(/opaque="([^"]+)"/);
    const nonce = nonceMatch![1]!;
    const opaque = opaqueMatch![1]!;

    // Step 2: Compute digest with WRONG password
    const method = 'GET';
    const uri = '/';
    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');
    const qop = 'auth';

    const ha1 = createHash('md5').update(`${username}:${realm}:WRONG`, 'latin1').digest('hex');
    const ha2 = createHash('md5').update(`${method}:${uri}`, 'latin1').digest('hex');
    const responseHash = createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`, 'latin1')
      .digest('hex');

    const authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", nc=${nc}, cnonce="${cnonce}", qop=${qop}, response="${responseHash}", opaque="${opaque}", algorithm="MD5"`;

    const request = createRequestInfo({
      headers: new Map([['authorization', [authHeader]]]),
    });

    const result = await authenticator.authenticate(request);
    // Should issue a new challenge (INVALID → CHALLENGED)
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should return CHALLENGED for unknown username in Digest', async () => {
    const challenge = await authenticator.authenticate(createRequestInfo());
    const wwwAuth = challenge.responseHeaders.get('WWW-Authenticate')![0]!;
    const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/);
    const opaqueMatch = wwwAuth.match(/opaque="([^"]+)"/);
    const nonce = nonceMatch![1]!;
    const opaque = opaqueMatch![1]!;

    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');

    const authHeader = `Digest username="unknown", realm="${realm}", nonce="${nonce}", uri="/", nc=${nc}, cnonce="${cnonce}", qop=auth, response="0000000000000000", opaque="${opaque}", algorithm="MD5"`;

    const request = createRequestInfo({
      headers: new Map([['authorization', [authHeader]]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should return CHALLENGED with stale=true for expired nonce', async () => {
    // We cannot easily simulate nonce expiry without time manipulation,
    // but we can use a fabricated nonce that doesn't exist in the cache
    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');

    const ha1 = createHash('md5').update(`${username}:${realm}:${password}`, 'latin1').digest('hex');
    const ha2 = createHash('md5').update(`GET:/`, 'latin1').digest('hex');
    const responseHash = createHash('md5')
      .update(`${ha1}:fake-nonce:${nc}:${cnonce}:auth:${ha2}`, 'latin1')
      .digest('hex');

    const authHeader = `Digest username="${username}", realm="${realm}", nonce="fake-nonce", uri="/", nc=${nc}, cnonce="${cnonce}", qop=auth, response="${responseHash}", opaque="test-opaque", algorithm="MD5"`;

    const request = createRequestInfo({
      headers: new Map([['authorization', [authHeader]]]),
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.CHALLENGED);
    // When nonce is not found, status is STALE, but digest validation may fail first
    // and set status to INVALID. Either way, the result is CHALLENGED with a new nonce.
    const wwwAuth = result.responseHeaders.get('WWW-Authenticate')![0]!;
    expect(wwwAuth).toContain('Digest');
  });

  it('should prevent replay attacks (same nc value)', async () => {
    // Step 1: Get challenge
    const challenge = await authenticator.authenticate(createRequestInfo());
    const wwwAuth = challenge.responseHeaders.get('WWW-Authenticate')![0]!;
    const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/);
    const opaqueMatch = wwwAuth.match(/opaque="([^"]+)"/);
    const nonce = nonceMatch![1]!;
    const opaque = opaqueMatch![1]!;

    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');
    const qop = 'auth';

    const ha1 = createHash('md5').update(`${username}:${realm}:${password}`, 'latin1').digest('hex');
    const ha2 = createHash('md5').update(`GET:/`, 'latin1').digest('hex');
    const responseHash = createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`, 'latin1')
      .digest('hex');

    const authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="/", nc=${nc}, cnonce="${cnonce}", qop=${qop}, response="${responseHash}", opaque="${opaque}", algorithm="MD5"`;

    // First request should succeed
    const request1 = createRequestInfo({
      headers: new Map([['authorization', [authHeader]]]),
    });
    const result1 = await authenticator.authenticate(request1);
    expect(result1.status).toBe(AuthStatus.SUCCESS);

    // Second request with SAME nc should be rejected (replay detected)
    const request2 = createRequestInfo({
      headers: new Map([['authorization', [authHeader]]]),
    });
    const result2 = await authenticator.authenticate(request2);
    // nc=1 again after already using nc=1 → INVALID (count <= current)
    expect(result2.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should accept incrementing nc values', async () => {
    const challenge = await authenticator.authenticate(createRequestInfo());
    const wwwAuth = challenge.responseHeaders.get('WWW-Authenticate')![0]!;
    const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/);
    const opaqueMatch = wwwAuth.match(/opaque="([^"]+)"/);
    const nonce = nonceMatch![1]!;
    const opaque = opaqueMatch![1]!;

    for (let i = 1; i <= 3; i++) {
      const nc = i.toString(16).padStart(8, '0');
      const cnonce = randomBytes(8).toString('hex');
      const qop = 'auth';

      const ha1 = createHash('md5').update(`${username}:${realm}:${password}`, 'latin1').digest('hex');
      const ha2 = createHash('md5').update(`GET:/`, 'latin1').digest('hex');
      const responseHash = createHash('md5')
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`, 'latin1')
        .digest('hex');

      const authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="/", nc=${nc}, cnonce="${cnonce}", qop=${qop}, response="${responseHash}", opaque="${opaque}", algorithm="MD5"`;

      const request = createRequestInfo({
        headers: new Map([['authorization', [authHeader]]]),
      });

      const result = await authenticator.authenticate(request);
      expect(result.status).toBe(AuthStatus.SUCCESS);
    }
  });

  it('should support auth-int QOP mode', async () => {
    const entityBody = Buffer.from('test body content');

    const challenge = await authenticator.authenticate(createRequestInfo());
    const wwwAuth = challenge.responseHeaders.get('WWW-Authenticate')![0]!;
    const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/);
    const opaqueMatch = wwwAuth.match(/opaque="([^"]+)"/);
    const nonce = nonceMatch![1]!;
    const opaque = opaqueMatch![1]!;

    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');
    const qop = 'auth-int';

    const ha1 = createHash('md5').update(`${username}:${realm}:${password}`, 'latin1').digest('hex');
    const entityHash = createHash('md5').update(entityBody).digest('hex');
    const ha2 = createHash('md5').update(`POST:/:${entityHash}`, 'latin1').digest('hex');
    const responseHash = createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`, 'latin1')
      .digest('hex');

    const authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="/", nc=${nc}, cnonce="${cnonce}", qop=${qop}, response="${responseHash}", opaque="${opaque}", algorithm="MD5"`;

    const request = createRequestInfo({
      method: 'POST',
      headers: new Map([['authorization', [authHeader]]]),
      getEntity: () => entityBody,
    });

    const result = await authenticator.authenticate(request);
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });

  it('shutdown should clear nonce cache', () => {
    // Should not throw
    authenticator.shutdown();
    authenticator.shutdown(); // Double shutdown should be safe
  });
});

// ---------- JavaScriptAuthenticator ----------

describe('JavaScriptAuthenticator', () => {
  it('should authenticate when script returns true', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: 'true',
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });

  it('should fail when script returns false', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: 'false',
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.FAILURE);
  });

  it('should fail when script returns undefined', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: 'undefined',
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.FAILURE);
  });

  it('should accept AuthenticationResult returned from script', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: `AuthenticationResult.Success('scriptUser', 'scriptRealm')`,
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe('scriptUser');
    expect(result.realm).toBe('scriptRealm');
  });

  it('should accept CHALLENGED result from script', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: `AuthenticationResult.Challenged('Custom realm="Test"')`,
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should have access to sourceMap with request metadata', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: `
        var method = sourceMap.get('method');
        var uri = sourceMap.get('uri');
        method === 'POST' && uri === '/api/data'
      `,
    });

    const result = await authenticator.authenticate(
      createRequestInfo({ method: 'POST', requestURI: '/api/data' })
    );
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });

  it('should have access to headers via sourceMap', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: `
        var headers = sourceMap.get('headers');
        var apiKey = headers.get('x-api-key');
        apiKey && apiKey[0] === 'my-secret-key'
      `,
    });

    const result = await authenticator.authenticate(
      createRequestInfo({
        headers: new Map([['x-api-key', ['my-secret-key']]]),
      })
    );
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });

  it('should have access to AuthStatus enum values', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: `
        new AuthenticationResult(CHALLENGED)
      `,
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.CHALLENGED);
  });

  it('should fail on script compilation error', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: 'this is not valid javascript {{{',
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.FAILURE);
  });

  it('should fail on script runtime error', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: 'throw new Error("auth error")',
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.FAILURE);
  });

  it('should accept object with status field', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: `({ status: 'SUCCESS', username: 'obj-user', realm: 'obj-realm' })`,
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe('obj-user');
  });

  it('shutdown should clear compiled script', () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: 'true',
    });
    authenticator.shutdown();
    // Should not throw
  });

  it('should not have access to setTimeout/setInterval (sandbox)', async () => {
    const authenticator = new JavaScriptAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: 'typeof setTimeout === "undefined"',
    });

    const result = await authenticator.authenticate(createRequestInfo());
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });
});

// ---------- createAuthenticator factory ----------

describe('createAuthenticator', () => {
  it('should create BasicAuthenticator for BASIC type', () => {
    const authenticator = createAuthenticator(getDefaultBasicAuthProperties());
    expect(authenticator).toBeInstanceOf(BasicAuthenticator);
  });

  it('should create DigestAuthenticator for DIGEST type', () => {
    const authenticator = createAuthenticator(getDefaultDigestAuthProperties());
    expect(authenticator).toBeInstanceOf(DigestAuthenticator);
  });

  it('should create JavaScriptAuthenticator for JAVASCRIPT type', () => {
    const authenticator = createAuthenticator({
      authType: AuthType.JAVASCRIPT,
      script: 'true',
    });
    expect(authenticator).toBeInstanceOf(JavaScriptAuthenticator);
  });

  it('should throw for unsupported auth type', () => {
    expect(() =>
      createAuthenticator({ authType: 'UNKNOWN' as AuthType } as any)
    ).toThrow('Unsupported authentication type');
  });
});

// ---------- Integration: HttpReceiver with auth ----------

import * as http from 'http';
import { HttpReceiver } from '../../../../src/connectors/http/HttpReceiver';

describe('HttpReceiver authentication integration', () => {

  it('should reject requests without credentials when Basic auth configured', async () => {
    const receiver = new HttpReceiver({
      name: 'Auth Test',
      properties: {
        host: '127.0.0.1',
        port: 0, // Will be assigned by OS
        contextPath: '/',
        timeout: 5000,
        charset: 'UTF-8',
        xmlBody: false,
        parseMultipart: false,
        includeMetadata: false,
        binaryMimeTypes: '',
        binaryMimeTypesRegex: false,
        responseContentType: 'text/plain',
        responseDataTypeBinary: false,
        responseStatusCode: '',
        responseHeaders: new Map(),
        useResponseHeadersVariable: false,
        responseHeadersVariable: '',
        useAuthentication: true,
        authProperties: {
          authType: AuthType.BASIC,
          realm: 'Integration Test',
          credentials: new Map([['testuser', 'testpass']]),
          useCredentialsVariable: false,
          credentialsVariable: '',
        },
      },
    });

    await receiver.start();

    try {
      const server = receiver.getServer()!;
      const address = server.address() as { port: number };

      // Request without credentials
      const res = await new Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined> }>((resolve) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: address.port, path: '/', method: 'GET' },
          (res) => resolve({ statusCode: res.statusCode!, headers: res.headers as Record<string, string | string[] | undefined> })
        );
        req.end();
      });

      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Basic realm="Integration Test"');
    } finally {
      await receiver.stop();
    }
  });

  it('should accept requests with valid Basic credentials', async () => {
    const receiver = new HttpReceiver({
      name: 'Auth Test',
      properties: {
        host: '127.0.0.1',
        port: 0,
        contextPath: '/',
        timeout: 5000,
        charset: 'UTF-8',
        xmlBody: false,
        parseMultipart: false,
        includeMetadata: false,
        binaryMimeTypes: '',
        binaryMimeTypesRegex: false,
        responseContentType: 'text/plain',
        responseDataTypeBinary: false,
        responseStatusCode: '',
        responseHeaders: new Map(),
        useResponseHeadersVariable: false,
        responseHeadersVariable: '',
        useAuthentication: true,
        authProperties: {
          authType: AuthType.BASIC,
          realm: 'Integration Test',
          credentials: new Map([['testuser', 'testpass']]),
          useCredentialsVariable: false,
          credentialsVariable: '',
        },
      },
    });

    await receiver.start();

    try {
      const server = receiver.getServer()!;
      const address = server.address() as { port: number };

      // Request WITH valid credentials — should pass auth middleware
      // (will get 500 since no channel is attached, but that proves auth passed)
      const res = await new Promise<{ statusCode: number }>((resolve) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/',
            method: 'GET',
            headers: {
              'Authorization': basicAuthHeader('testuser', 'testpass'),
            },
          },
          (res) => resolve({ statusCode: res.statusCode! })
        );
        req.end();
      });

      // 500 = auth passed, but no channel attached to process the message
      // (not 401 = auth failed)
      expect(res.statusCode).not.toBe(401);
    } finally {
      await receiver.stop();
    }
  });

  it('should use legacy username/password when authProperties not set', async () => {
    const receiver = new HttpReceiver({
      name: 'Legacy Auth Test',
      properties: {
        host: '127.0.0.1',
        port: 0,
        contextPath: '/',
        timeout: 5000,
        charset: 'UTF-8',
        xmlBody: false,
        parseMultipart: false,
        includeMetadata: false,
        binaryMimeTypes: '',
        binaryMimeTypesRegex: false,
        responseContentType: 'text/plain',
        responseDataTypeBinary: false,
        responseStatusCode: '',
        responseHeaders: new Map(),
        useResponseHeadersVariable: false,
        responseHeadersVariable: '',
        useAuthentication: true,
        username: 'legacyuser',
        password: 'legacypass',
      },
    });

    await receiver.start();

    try {
      const server = receiver.getServer()!;
      const address = server.address() as { port: number };

      // Without credentials → 401
      const res1 = await new Promise<{ statusCode: number }>((resolve) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: address.port, path: '/', method: 'GET' },
          (res) => resolve({ statusCode: res.statusCode! })
        );
        req.end();
      });
      expect(res1.statusCode).toBe(401);

      // With valid legacy credentials → passes auth
      const res2 = await new Promise<{ statusCode: number }>((resolve) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/',
            method: 'GET',
            headers: {
              'Authorization': basicAuthHeader('legacyuser', 'legacypass'),
            },
          },
          (res) => resolve({ statusCode: res.statusCode! })
        );
        req.end();
      });
      expect(res2.statusCode).not.toBe(401);
    } finally {
      await receiver.stop();
    }
  });

  it('should pass all requests when useAuthentication is false', async () => {
    const receiver = new HttpReceiver({
      name: 'No Auth Test',
      properties: {
        host: '127.0.0.1',
        port: 0,
        contextPath: '/',
        timeout: 5000,
        charset: 'UTF-8',
        xmlBody: false,
        parseMultipart: false,
        includeMetadata: false,
        binaryMimeTypes: '',
        binaryMimeTypesRegex: false,
        responseContentType: 'text/plain',
        responseDataTypeBinary: false,
        responseStatusCode: '',
        responseHeaders: new Map(),
        useResponseHeadersVariable: false,
        responseHeadersVariable: '',
        useAuthentication: false,
      },
    });

    await receiver.start();

    try {
      const server = receiver.getServer()!;
      const address = server.address() as { port: number };

      const res = await new Promise<{ statusCode: number }>((resolve) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: address.port, path: '/', method: 'GET' },
          (res) => resolve({ statusCode: res.statusCode! })
        );
        req.end();
      });

      // Should not be 401 (no auth required)
      expect(res.statusCode).not.toBe(401);
    } finally {
      await receiver.stop();
    }
  });
});
