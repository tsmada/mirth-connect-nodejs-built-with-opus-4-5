/**
 * Coverage tests for HttpDispatcher — exercises send(), executeRequest(),
 * buildUrl(), buildBody(), buildHeaders(), buildBasicAuthHeader(),
 * buildDigestAuthHeader(), buildPreemptiveDigestHeader(), onStop(),
 * mergeVariableHeaders(), mergeVariableParameters(), getResponse().
 *
 * These tests mock the global `fetch` to test the full send pipeline
 * without network I/O.
 */

import { HttpDispatcher } from '../../../../src/connectors/http/HttpDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
// HttpConnectorProperties is imported transitively via HttpDispatcher

// ─── Helpers ───────────────────────────────────────────────────────────

function createMsg(overrides?: {
  channelMap?: Map<string, unknown>;
  sourceMap?: Map<string, unknown>;
  connectorMap?: Map<string, unknown>;
  rawData?: string;
  encodedData?: string;
}): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-ch',
    channelName: 'Test',
    connectorName: 'HTTP Sender',
    serverId: 'srv-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });
  if (overrides?.channelMap) {
    for (const [k, v] of overrides.channelMap) msg.getChannelMap().set(k, v);
  }
  if (overrides?.sourceMap) {
    for (const [k, v] of overrides.sourceMap) msg.getSourceMap().set(k, v);
  }
  if (overrides?.connectorMap) {
    for (const [k, v] of overrides.connectorMap) msg.getConnectorMap().set(k, v);
  }
  if (overrides?.rawData) {
    msg.setContent({ contentType: ContentType.RAW, content: overrides.rawData, dataType: 'RAW', encrypted: false });
  }
  if (overrides?.encodedData) {
    msg.setContent({ contentType: ContentType.ENCODED, content: overrides.encodedData, dataType: 'HL7V2', encrypted: false });
  }
  return msg;
}

function mockFetchOk(body = 'OK', status = 200, headers?: Record<string, string>) {
  const headerEntries = Object.entries(headers ?? { 'content-type': 'text/plain' });
  const hdrs = new Map<string, string>();
  for (const [k, v] of headerEntries) hdrs.set(k, v);

  return jest.fn().mockResolvedValue({
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => hdrs.get(name.toLowerCase()) ?? null,
      forEach: (cb: (value: string, key: string) => void) => {
        for (const [k, v] of hdrs) cb(v, k);
      },
    },
    arrayBuffer: async () => {
      const buf = Buffer.from(body);
      // Return a proper ArrayBuffer copy to avoid shared-buffer issues
      const ab = new ArrayBuffer(buf.length);
      const view = new Uint8Array(ab);
      buf.copy(Buffer.from(view.buffer));
      return ab;
    },
    text: async () => body,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('HttpDispatcher coverage', () => {
  const originalFetch = globalThis.fetch;
  let dispatcher: HttpDispatcher;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── send() ───────────────────────────────────────────────────────────

  describe('send() — success path', () => {
    it('should set status SENT for HTTP 200', async () => {
      globalThis.fetch = mockFetchOk('{"ok":true}', 200, { 'content-type': 'application/json' });

      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost:8080/api', method: 'POST', content: 'body' },
      });

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(msg.getConnectorMap().get('responseStatusLine')).toContain('200');
      // Response body stored as RESPONSE content
      const resp = msg.getContent(ContentType.RESPONSE);
      expect(resp?.content).toBe('{"ok":true}');
    });

    it('should set sendDate on success', async () => {
      globalThis.fetch = mockFetchOk('OK');
      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/x', method: 'GET' } });
      const msg = createMsg();
      await dispatcher.send(msg);
      expect(msg.getSendDate()).toBeDefined();
    });
  });

  describe('send() — HTTP error (status >= 400)', () => {
    it('should keep status QUEUED and set processing error for 500', async () => {
      globalThis.fetch = mockFetchOk('Server Error', 500);
      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/api', method: 'POST' } });

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.QUEUED);
      expect(msg.getConnectorMap().get('responseStatusMessage')).toContain('error response');
    });

    it('should keep status QUEUED for 404', async () => {
      globalThis.fetch = mockFetchOk('Not Found', 404);
      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/api', method: 'GET' } });
      const msg = createMsg();
      await dispatcher.send(msg);
      expect(msg.getStatus()).toBe(Status.QUEUED);
    });
  });

  describe('send() — connection error', () => {
    it('should keep QUEUED on network error', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/api' } });
      const msg = createMsg();
      await dispatcher.send(msg);
      expect(msg.getStatus()).toBe(Status.QUEUED);
    });

    it('should keep QUEUED on timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = jest.fn().mockRejectedValue(abortError);

      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/api', socketTimeout: 100 } });
      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.QUEUED);
    });

    it('should detect ETIMEDOUT as timeout', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT'));
      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/api', socketTimeout: 50 } });
      const msg = createMsg();
      await dispatcher.send(msg);
      expect(msg.getStatus()).toBe(Status.QUEUED);
    });
  });

  // ── buildUrl ─────────────────────────────────────────────────────────

  describe('buildUrl — query parameters', () => {
    it('should append query params for GET', async () => {
      const params = new Map<string, string[]>([['foo', ['bar']], ['multi', ['a', 'b']]]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'GET', parameters: params },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('foo=bar');
      expect(calledUrl).toContain('multi=a');
      expect(calledUrl).toContain('multi=b');
    });

    it('should append query params for DELETE', async () => {
      const params = new Map<string, string[]>([['id', ['123']]]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'DELETE', parameters: params },
      });
      const msg = createMsg();
      await dispatcher.send(msg);
      const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('id=123');
    });

    it('should NOT append params for form-urlencoded POST', async () => {
      const params = new Map<string, string[]>([['key', ['val']]]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'POST',
          parameters: params,
          contentType: 'application/x-www-form-urlencoded',
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);
      const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('key=val');
    });
  });

  // ── buildHeaders ─────────────────────────────────────────────────────

  describe('buildHeaders', () => {
    it('should auto-add Content-Type with charset for text content', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'POST', contentType: 'text/xml', charset: 'UTF-8' },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['Content-Type']).toContain('text/xml');
      expect(headers['Content-Type']).toContain('charset=UTF-8');
    });

    it('should NOT add charset for binary content types', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'POST',
          contentType: 'application/octet-stream',
          dataTypeBinary: true,
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['Content-Type']).not.toContain('charset');
    });

    it('should not override existing Content-Type header', async () => {
      const hdrs = new Map<string, string[]>([['Content-Type', ['application/custom']]]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'POST', headers: hdrs },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/custom');
    });
  });

  // ── buildBody ────────────────────────────────────────────────────────

  describe('buildBody — different content modes', () => {
    it('should send form-urlencoded body from parameters', async () => {
      const params = new Map<string, string[]>([['user', ['john']], ['age', ['30']]]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'POST',
          contentType: 'application/x-www-form-urlencoded',
          parameters: params,
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toContain('user=john');
      expect(opts.body).toContain('age=30');
    });

    it('should decode base64 binary content', async () => {
      const base64Content = Buffer.from('Hello Binary').toString('base64');
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'POST',
          content: base64Content,
          dataTypeBinary: true,
          contentType: 'application/octet-stream',
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toBeDefined();
    });

    it('should use encoded content from connector message when content is empty', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'POST', content: '' },
      });
      const msg = createMsg({ encodedData: 'ENCODED_DATA' });
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toBe('ENCODED_DATA');
    });

    it('should send multipart form data', async () => {
      const params = new Map<string, string[]>([['field', ['value']]]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'POST',
          multipart: true,
          parameters: params,
          content: 'some text content',
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toBeInstanceOf(FormData);
      // Content-Type should be removed so fetch auto-sets multipart boundary
      const headers = opts.headers as Record<string, string>;
      expect(headers['Content-Type']).toBeUndefined();
      expect(headers['content-type']).toBeUndefined();
    });

    it('should handle multipart with binary content', async () => {
      const base64 = Buffer.from('BinaryData').toString('base64');
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'POST',
          multipart: true,
          content: base64,
          dataTypeBinary: true,
          contentType: 'application/octet-stream',
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toBeInstanceOf(FormData);
    });

    it('should detect multipart from contentType header', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'POST',
          contentType: 'multipart/form-data',
          content: 'file content',
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);
      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toBeInstanceOf(FormData);
    });

    it('should return null body for GET/DELETE', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'GET' },
      });
      const msg = createMsg();
      await dispatcher.send(msg);
      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toBeUndefined();
    });
  });

  // ── GZIP handling ────────────────────────────────────────────────────

  describe('gzip request/response', () => {
    it('should gzip-compress body when content-encoding is gzip', async () => {
      const hdrs = new Map<string, string[]>([['content-encoding', ['gzip']]]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'POST', headers: hdrs, content: 'gzip me' },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      // Body should be a Buffer (gzipped), not a plain string
      expect(Buffer.isBuffer(opts.body)).toBe(true);
    });

    it('should decompress gzip response', async () => {
      const { gzipSync } = await import('zlib');
      const compressed = gzipSync(Buffer.from('decompressed content'));

      globalThis.fetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: {
          get: (name: string) => {
            if (name === 'content-encoding') return 'gzip';
            if (name === 'content-type') return 'text/plain';
            return null;
          },
          forEach: (cb: (v: string, k: string) => void) => {
            cb('gzip', 'content-encoding');
            cb('text/plain', 'content-type');
          },
        },
        arrayBuffer: async () => compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
      });

      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/api', method: 'GET' } });
      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getContent(ContentType.RESPONSE)?.content).toBe('decompressed content');
    });

    it('should use original body if gzip decompression fails', async () => {
      const badData = Buffer.from('not gzipped');
      globalThis.fetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: {
          get: (name: string) => {
            if (name === 'content-encoding') return 'gzip';
            if (name === 'content-type') return 'text/plain';
            return null;
          },
          forEach: (cb: (v: string, k: string) => void) => {
            cb('gzip', 'content-encoding');
            cb('text/plain', 'content-type');
          },
        },
        arrayBuffer: async () => badData.buffer.slice(badData.byteOffset, badData.byteOffset + badData.byteLength),
      });

      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/api', method: 'GET' } });
      const msg = createMsg();
      await dispatcher.send(msg);

      // Should still get a response (original, non-decompressed)
      expect(msg.getContent(ContentType.RESPONSE)?.content).toBeDefined();
    });
  });

  // ── Binary response ──────────────────────────────────────────────────

  describe('binary response handling', () => {
    it('should base64-encode binary response', async () => {
      const binaryBody = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG header bytes
      globalThis.fetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: {
          get: (name: string) => {
            if (name === 'content-type') return 'image/png';
            return null;
          },
          forEach: (cb: (v: string, k: string) => void) => cb('image/png', 'content-type'),
        },
        arrayBuffer: async () => binaryBody.buffer.slice(binaryBody.byteOffset, binaryBody.byteOffset + binaryBody.byteLength),
      });

      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'GET', responseBinaryMimeTypes: 'image/png', responseBinaryMimeTypesRegex: false },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const responseContent = msg.getContent(ContentType.RESPONSE)?.content;
      expect(responseContent).toBe(binaryBody.toString('base64'));
    });
  });

  // ── Authentication ───────────────────────────────────────────────────

  describe('Basic authentication', () => {
    it('should add Basic auth header', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'GET',
          useAuthentication: true,
          authenticationType: 'Basic',
          username: 'admin',
          password: 'secret',
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      const expected = Buffer.from('admin:secret').toString('base64');
      expect(headers['Authorization']).toBe(`Basic ${expected}`);
    });
  });

  describe('Digest authentication', () => {
    it('should handle 401 challenge-response for Digest auth', async () => {
      const challengeHeaders = new Map([['www-authenticate', 'Digest realm="test", nonce="abc123", qop="auth"']]);
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 401,
            statusText: 'Unauthorized',
            ok: false,
            headers: {
              get: (name: string) => challengeHeaders.get(name.toLowerCase()) ?? null,
              forEach: (cb: (v: string, k: string) => void) => { for (const [k, v] of challengeHeaders) cb(v, k); },
            },
            arrayBuffer: async () => Buffer.from('').buffer,
          };
        }
        // Second call succeeds
        return {
          status: 200,
          statusText: 'OK',
          ok: true,
          headers: {
            get: (name: string) => name === 'content-type' ? 'text/plain' : null,
            forEach: (cb: (v: string, k: string) => void) => cb('text/plain', 'content-type'),
          },
          arrayBuffer: async () => Buffer.from('OK').buffer.slice(0, 2),
        };
      });

      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'GET',
          useAuthentication: true,
          authenticationType: 'Digest',
          username: 'user',
          password: 'pass',
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      // Should have made 2 fetch calls (challenge + retry)
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(msg.getStatus()).toBe(Status.SENT);

      // Second call should include Authorization: Digest header
      const secondCallOpts = (globalThis.fetch as jest.Mock).mock.calls[1][1] as RequestInit;
      const headers = secondCallOpts.headers as Record<string, string>;
      expect(headers['Authorization']).toContain('Digest');
      expect(headers['Authorization']).toContain('username="user"');
    });

    it('should use preemptive digest with cached nonce', async () => {
      // First call: trigger digest challenge to cache nonce
      const challengeHeaders = new Map([['www-authenticate', 'Digest realm="test", nonce="xyz789", qop="auth", opaque="op1"']]);
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 401,
            statusText: 'Unauthorized',
            ok: false,
            headers: {
              get: (name: string) => challengeHeaders.get(name.toLowerCase()) ?? null,
              forEach: (cb: (v: string, k: string) => void) => { for (const [k, v] of challengeHeaders) cb(v, k); },
            },
            arrayBuffer: async () => Buffer.from('').buffer,
          };
        }
        return {
          status: 200,
          statusText: 'OK',
          ok: true,
          headers: {
            get: (name: string) => name === 'content-type' ? 'text/plain' : null,
            forEach: (cb: (v: string, k: string) => void) => cb('text/plain', 'content-type'),
          },
          arrayBuffer: async () => Buffer.from('OK').buffer.slice(0, 2),
        };
      });

      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api',
          method: 'GET',
          useAuthentication: true,
          authenticationType: 'Digest',
          usePreemptiveAuthentication: true,
          username: 'user',
          password: 'pass',
        },
      });

      // First send — triggers challenge
      await dispatcher.send(createMsg());

      // Reset mock for second send
      callCount = 0;
      (globalThis.fetch as jest.Mock).mockClear();
      globalThis.fetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: {
          get: (name: string) => name === 'content-type' ? 'text/plain' : null,
          forEach: (cb: (v: string, k: string) => void) => cb('text/plain', 'content-type'),
        },
        arrayBuffer: async () => Buffer.from('OK').buffer.slice(0, 2),
      });

      // Second send — should use preemptive digest
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['Authorization']).toContain('Digest');
      expect(headers['Authorization']).toContain('opaque="op1"');
    });

    it('should handle digest without qop', async () => {
      const challengeHeaders = new Map([['www-authenticate', 'Digest realm="simple", nonce="n1"']]);
      let callCount = 0;
      globalThis.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 401, statusText: 'Unauthorized', ok: false,
            headers: {
              get: (n: string) => challengeHeaders.get(n.toLowerCase()) ?? null,
              forEach: (cb: (v: string, k: string) => void) => { for (const [k, v] of challengeHeaders) cb(v, k); },
            },
            arrayBuffer: async () => Buffer.from('').buffer,
          };
        }
        return {
          status: 200, statusText: 'OK', ok: true,
          headers: {
            get: () => 'text/plain',
            forEach: (cb: (v: string, k: string) => void) => cb('text/plain', 'content-type'),
          },
          arrayBuffer: async () => Buffer.from('OK').buffer.slice(0, 2),
        };
      });

      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api', method: 'POST',
          useAuthentication: true, authenticationType: 'Digest',
          username: 'u', password: 'p',
        },
      });
      await dispatcher.send(createMsg());
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── onStop ───────────────────────────────────────────────────────────

  describe('onStop', () => {
    it('should destroy and recreate agents', async () => {
      dispatcher = new HttpDispatcher({ metaDataId: 1 });
      const oldAgent = dispatcher.getHttpAgent();
      const destroySpy = jest.spyOn(oldAgent, 'destroy');

      await (dispatcher as any).onStop();

      expect(destroySpy).toHaveBeenCalled();
      // New agent should be a fresh instance
      expect(dispatcher.getHttpAgent()).not.toBe(oldAgent);
    });
  });

  // ── mergeVariableHeaders ─────────────────────────────────────────────

  describe('mergeVariableHeaders', () => {
    it('should merge Map headers from channelMap variable', async () => {
      const varHeaders = new Map([['X-Dynamic', 'dynVal']]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api', method: 'GET',
          useHeadersVariable: true, headersVariable: 'myHeaders',
        },
      });
      const msg = createMsg({ channelMap: new Map([['myHeaders', varHeaders]]) });
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Dynamic']).toBe('dynVal');
    });

    it('should merge plain object headers from channelMap variable', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api', method: 'GET',
          useHeadersVariable: true, headersVariable: 'objHeaders',
        },
      });
      const msg = createMsg({
        channelMap: new Map([['objHeaders', { 'X-From-Obj': 'objVal' }]]),
      });
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-From-Obj']).toBe('objVal');
    });

    it('should append to existing header values', async () => {
      const existingHeaders = new Map<string, string[]>([['X-Multi', ['first']]]);
      const varHeaders = new Map([['X-Multi', 'second']]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api', method: 'GET',
          headers: existingHeaders,
          useHeadersVariable: true, headersVariable: 'h',
        },
      });
      const msg = createMsg({ channelMap: new Map([['h', varHeaders]]) });
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Multi']).toContain('first');
      expect(headers['X-Multi']).toContain('second');
    });

    it('should skip when variable is not found', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api', method: 'GET',
          useHeadersVariable: true, headersVariable: 'nonExistent',
        },
      });
      const msg = createMsg();
      await dispatcher.send(msg);
      // Should not throw
      expect(msg.getStatus()).toBe(Status.SENT);
    });
  });

  // ── mergeVariableParameters ──────────────────────────────────────────

  describe('mergeVariableParameters', () => {
    it('should merge Map parameters from channelMap variable', async () => {
      const varParams = new Map([['extra', 'val']]);
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api', method: 'GET',
          useParametersVariable: true, parametersVariable: 'myParams',
        },
      });
      const msg = createMsg({ channelMap: new Map([['myParams', varParams]]) });
      await dispatcher.send(msg);

      const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('extra=val');
    });

    it('should merge plain object parameters', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: {
          host: 'http://localhost/api', method: 'GET',
          useParametersVariable: true, parametersVariable: 'objParams',
        },
      });
      const msg = createMsg({
        channelMap: new Map([['objParams', { k: 'v' }]]),
      });
      await dispatcher.send(msg);
      const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('k=v');
    });
  });

  // ── Response headers ─────────────────────────────────────────────────

  describe('response headers', () => {
    it('should store response headers in connector map', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: {
          get: (name: string) => name === 'content-type' ? 'text/plain' : null,
          forEach: (cb: (v: string, k: string) => void) => {
            cb('text/plain', 'content-type');
            cb('custom-value', 'x-custom');
          },
        },
        arrayBuffer: async () => Buffer.from('response').buffer.slice(0, 8),
      });

      dispatcher = new HttpDispatcher({ metaDataId: 1, properties: { host: 'http://localhost/api', method: 'GET' } });
      const msg = createMsg();
      await dispatcher.send(msg);

      const respHeaders = msg.getConnectorMap().get('responseHeaders') as Map<string, string[]>;
      expect(respHeaders).toBeInstanceOf(Map);
      expect(respHeaders.get('x-custom')).toEqual(['custom-value']);
    });
  });

  // ── AbortError in executeRequest ─────────────────────────────────────

  describe('timeout in executeRequest', () => {
    it('should rethrow AbortError as descriptive timeout message', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = jest.fn().mockRejectedValue(abortErr);

      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'GET', socketTimeout: 5000 },
      });
      const msg = createMsg();
      await dispatcher.send(msg);
      // The error is caught in send() and kept as QUEUED
      expect(msg.getStatus()).toBe(Status.QUEUED);
    });
  });

  // ── PATCH / PUT body handling ────────────────────────────────────────

  describe('PATCH and PUT methods include body', () => {
    it('should include body for PATCH', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'PATCH', content: '{"update": true}' },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toBe('{"update": true}');
    });

    it('should include body for PUT', async () => {
      globalThis.fetch = mockFetchOk();
      dispatcher = new HttpDispatcher({
        metaDataId: 1,
        properties: { host: 'http://localhost/api', method: 'PUT', content: '<xml/>' },
      });
      const msg = createMsg();
      await dispatcher.send(msg);

      const opts = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(opts.body).toBe('<xml/>');
    });
  });
});
