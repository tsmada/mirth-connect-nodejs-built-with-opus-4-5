/**
 * Tests for useCredentialsVariable support in BasicAuthenticator and DigestAuthenticator.
 *
 * Validates that when useCredentialsVariable=true, the authenticators resolve
 * credentials from a CredentialsResolver callback (message map lookup) rather
 * than using static credentials. Falls back to static when resolver returns
 * undefined or empty map.
 */

import { createHash, randomBytes } from 'crypto';
import {
  AuthStatus,
  BasicAuthenticator,
  DigestAuthenticator,
  getDefaultBasicAuthProperties,
  getDefaultDigestAuthProperties,
} from '../../../../../src/connectors/http/auth/index';
import type { CredentialsResolver, RequestInfo } from '../../../../../src/connectors/http/auth/types';

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

function basicAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`, 'latin1').toString('base64');
}

// ---------- BasicAuthenticator: useCredentialsVariable ----------

describe('BasicAuthenticator useCredentialsVariable', () => {
  it('should use static credentials when useCredentialsVariable=false', async () => {
    const props = getDefaultBasicAuthProperties();
    props.realm = 'Test';
    props.credentials.set('admin', 'static-pass');
    props.useCredentialsVariable = false;
    const auth = new BasicAuthenticator(props);

    const resolver: CredentialsResolver = () => new Map([['admin', 'dynamic-pass']]);

    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('admin', 'static-pass')]]]),
    });

    // Even with a resolver provided, static credentials should be used
    const result = await auth.authenticate(request, resolver);
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe('admin');
  });

  it('should use resolved credentials when useCredentialsVariable=true and resolver returns credentials', async () => {
    const props = getDefaultBasicAuthProperties();
    props.realm = 'Test';
    props.credentials.set('admin', 'static-pass');
    props.useCredentialsVariable = true;
    props.credentialsVariable = 'myCredentials';
    const auth = new BasicAuthenticator(props);

    const dynamicCreds = new Map([['admin', 'dynamic-pass']]);
    const resolver: CredentialsResolver = (varName) => {
      expect(varName).toBe('myCredentials');
      return dynamicCreds;
    };

    // Static password should fail when variable credentials are active
    const reqStatic = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('admin', 'static-pass')]]]),
    });
    const resultStatic = await auth.authenticate(reqStatic, resolver);
    expect(resultStatic.status).toBe(AuthStatus.CHALLENGED);

    // Dynamic password should succeed
    const reqDynamic = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('admin', 'dynamic-pass')]]]),
    });
    const resultDynamic = await auth.authenticate(reqDynamic, resolver);
    expect(resultDynamic.status).toBe(AuthStatus.SUCCESS);
    expect(resultDynamic.username).toBe('admin');
  });

  it('should fall back to static credentials when useCredentialsVariable=true but resolver returns undefined', async () => {
    const props = getDefaultBasicAuthProperties();
    props.realm = 'Test';
    props.credentials.set('admin', 'static-pass');
    props.useCredentialsVariable = true;
    props.credentialsVariable = 'missingVar';
    const auth = new BasicAuthenticator(props);

    const resolver: CredentialsResolver = () => undefined;

    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('admin', 'static-pass')]]]),
    });

    const result = await auth.authenticate(request, resolver);
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });

  it('should fall back to static credentials when useCredentialsVariable=true but resolver returns empty map', async () => {
    const props = getDefaultBasicAuthProperties();
    props.realm = 'Test';
    props.credentials.set('admin', 'static-pass');
    props.useCredentialsVariable = true;
    props.credentialsVariable = 'emptyVar';
    const auth = new BasicAuthenticator(props);

    const resolver: CredentialsResolver = () => new Map();

    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('admin', 'static-pass')]]]),
    });

    const result = await auth.authenticate(request, resolver);
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });

  it('should use static credentials when no credentialsResolver is provided (backward compatible)', async () => {
    const props = getDefaultBasicAuthProperties();
    props.realm = 'Test';
    props.credentials.set('admin', 'static-pass');
    props.useCredentialsVariable = true;
    props.credentialsVariable = 'someVar';
    const auth = new BasicAuthenticator(props);

    const request = createRequestInfo({
      headers: new Map([['authorization', [basicAuthHeader('admin', 'static-pass')]]]),
    });

    // No resolver passed — falls back to static
    const result = await auth.authenticate(request);
    expect(result.status).toBe(AuthStatus.SUCCESS);
  });
});

// ---------- DigestAuthenticator: useCredentialsVariable ----------

describe('DigestAuthenticator useCredentialsVariable', () => {
  const realm = 'Test Realm';
  const username = 'admin';
  const staticPassword = 'static-pass';
  const dynamicPassword = 'dynamic-pass';

  /**
   * Helper: perform a full Digest challenge-response cycle using given credentials.
   */
  async function digestAuthenticate(
    authenticator: DigestAuthenticator,
    user: string,
    password: string,
    resolver?: CredentialsResolver,
  ) {
    // Step 1: Get challenge
    const challenge = await authenticator.authenticate(createRequestInfo(), resolver);
    const wwwAuth = challenge.responseHeaders.get('WWW-Authenticate')![0]!;
    const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/);
    const opaqueMatch = wwwAuth.match(/opaque="([^"]+)"/);
    const nonce = nonceMatch![1]!;
    const opaque = opaqueMatch ? opaqueMatch[1]! : '';

    // Step 2: Compute digest
    const method = 'GET';
    const uri = '/';
    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');
    const qop = 'auth';

    const ha1 = createHash('md5').update(`${user}:${realm}:${password}`, 'latin1').digest('hex');
    const ha2 = createHash('md5').update(`${method}:${uri}`, 'latin1').digest('hex');
    const responseHash = createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`, 'latin1')
      .digest('hex');

    const authHeader = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", nc=${nc}, cnonce="${cnonce}", qop=${qop}, response="${responseHash}", opaque="${opaque}", algorithm="MD5"`;

    const request = createRequestInfo({
      headers: new Map([['authorization', [authHeader]]]),
    });

    return authenticator.authenticate(request, resolver);
  }

  it('should use static credentials when useCredentialsVariable=false', async () => {
    const props = getDefaultDigestAuthProperties();
    props.realm = realm;
    props.credentials.set(username, staticPassword);
    props.useCredentialsVariable = false;
    const auth = new DigestAuthenticator(props);

    const result = await digestAuthenticate(auth, username, staticPassword);
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe(username);

    auth.shutdown();
  });

  it('should use resolved credentials when useCredentialsVariable=true and resolver provides credentials', async () => {
    const props = getDefaultDigestAuthProperties();
    props.realm = realm;
    props.credentials.set(username, staticPassword);
    props.useCredentialsVariable = true;
    props.credentialsVariable = 'digestCreds';
    const auth = new DigestAuthenticator(props);

    const dynamicCreds = new Map([[username, dynamicPassword]]);
    const resolver: CredentialsResolver = (varName) => {
      expect(varName).toBe('digestCreds');
      return dynamicCreds;
    };

    // Dynamic password should succeed
    const result = await digestAuthenticate(auth, username, dynamicPassword, resolver);
    expect(result.status).toBe(AuthStatus.SUCCESS);
    expect(result.username).toBe(username);

    // Static password should fail (because variable credentials override)
    const resultStatic = await digestAuthenticate(auth, username, staticPassword, resolver);
    expect(resultStatic.status).toBe(AuthStatus.CHALLENGED);

    auth.shutdown();
  });

  it('should fall back to static credentials when resolver returns undefined', async () => {
    const props = getDefaultDigestAuthProperties();
    props.realm = realm;
    props.credentials.set(username, staticPassword);
    props.useCredentialsVariable = true;
    props.credentialsVariable = 'missingVar';
    const auth = new DigestAuthenticator(props);

    const resolver: CredentialsResolver = () => undefined;

    const result = await digestAuthenticate(auth, username, staticPassword, resolver);
    expect(result.status).toBe(AuthStatus.SUCCESS);

    auth.shutdown();
  });

  it('should use static credentials when no resolver is provided (backward compatible)', async () => {
    const props = getDefaultDigestAuthProperties();
    props.realm = realm;
    props.credentials.set(username, staticPassword);
    props.useCredentialsVariable = true;
    props.credentialsVariable = 'someVar';
    const auth = new DigestAuthenticator(props);

    // No resolver — even though useCredentialsVariable is true, falls back to static
    const result = await digestAuthenticate(auth, username, staticPassword);
    expect(result.status).toBe(AuthStatus.SUCCESS);

    auth.shutdown();
  });
});
