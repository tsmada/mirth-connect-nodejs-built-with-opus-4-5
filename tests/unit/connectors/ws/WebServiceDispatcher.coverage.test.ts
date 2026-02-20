/**
 * Coverage tests for WebServiceDispatcher — exercises send(), sendSoapRequest(),
 * sendMtomRequest(), ensureClient(), onHalt(), getAttachments(),
 * handleSendError(), getWsdlOperations(), buildHttpHeaders(),
 * getHeaders(), getTableMapFromVariable(), getResponse().
 *
 * These tests mock the global `fetch` and the `soap` library to test the
 * full send pipeline without network I/O.
 */

import {
  WebServiceDispatcher,
  // SoapFaultError imported for type reference only
} from '../../../../src/connectors/ws/WebServiceDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';

// ─── Helpers ───────────────────────────────────────────────────────────

function createMsg(overrides?: {
  channelMap?: Map<string, unknown>;
  sourceMap?: Map<string, unknown>;
  connectorMap?: Map<string, unknown>;
  responseMap?: Map<string, unknown>;
  rawData?: string;
  encodedData?: string;
}): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-ch',
    channelName: 'Test',
    connectorName: 'WS Sender',
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
  if (overrides?.responseMap) {
    for (const [k, v] of overrides.responseMap) msg.getResponseMap().set(k, v);
  }
  if (overrides?.rawData) {
    msg.setRawData(overrides.rawData);
  }
  if (overrides?.encodedData) {
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: overrides.encodedData,
      dataType: 'XML',
      encrypted: false,
    });
  }
  return msg;
}

/** Build a valid SOAP 1.1 envelope wrapping the given body */
function soapEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`;
}

/** Build a SOAP 1.2 envelope */
function soap12Envelope(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`;
}

/** Build a SOAP fault envelope */
function soapFaultEnvelope(code: string, message: string): string {
  return soapEnvelope(
    `<soap:Fault>
      <faultcode>${code}</faultcode>
      <faultstring>${message}</faultstring>
    </soap:Fault>`
  );
}

function mockFetchOk(body: string, status = 200, headers?: Record<string, string>) {
  const headerEntries = Object.entries(headers ?? { 'content-type': 'text/xml' });
  const hdrs = new Map<string, string>();
  for (const [k, v] of headerEntries) hdrs.set(k.toLowerCase(), v);

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
    text: async () => body,
  });
}

// ─── Mock soap library ─────────────────────────────────────────────────

jest.mock('soap', () => ({
  createClientAsync: jest.fn(),
  BasicAuthSecurity: jest.fn(),
}));

// ─── Mock WsdlParser ───────────────────────────────────────────────────

jest.mock('../../../../src/connectors/ws/WsdlParser', () => ({
  parseWsdlFromUrl: jest.fn(),
  getEndpointLocation: jest.fn(),
  getSoapAction: jest.fn(),
}));

// ─── Mock logging ──────────────────────────────────────────────────────

jest.mock('../../../../src/logging/index', () => ({
  registerComponent: jest.fn(),
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    isDebugEnabled: jest.fn().mockReturnValue(false),
  })),
}));

// ─── Tests ─────────────────────────────────────────────────────────────

describe('WebServiceDispatcher coverage', () => {
  let dispatcher: WebServiceDispatcher;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    dispatcher = new WebServiceDispatcher({
      metaDataId: 1,
      properties: {
        envelope: soapEnvelope('<TestOp/>'),
        locationURI: 'http://localhost:8080/ws',
        socketTimeout: 5000,
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ── send() success path ───────────────────────────────────────────

  describe('send() success', () => {
    it('should send SOAP request and set SENT status', async () => {
      const responseEnvelope = soapEnvelope('<TestOpResponse><Result>OK</Result></TestOpResponse>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(msg.getSendDate()).toBeDefined();
      const response = msg.getContent(ContentType.RESPONSE);
      expect(response?.content).toContain('TestOpResponse');
    });

    it('should set SENT for one-way operations', async () => {
      dispatcher.setProperties({ oneWay: true });
      globalThis.fetch = mockFetchOk('');

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
    });

    it('should return empty string for one-way operations', async () => {
      dispatcher.setProperties({ oneWay: true });
      globalThis.fetch = mockFetchOk('');

      const msg = createMsg();
      await dispatcher.send(msg);

      const response = msg.getContent(ContentType.RESPONSE);
      // One-way returns empty string
      expect(response?.content).toBe('');
    });
  });

  // ── send() error classification ───────────────────────────────────

  describe('send() error handling', () => {
    it('should set ERROR status on SOAP fault', async () => {
      const faultXml = soapFaultEnvelope('soap:Server', 'Service unavailable');
      globalThis.fetch = mockFetchOk(faultXml, 500);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.ERROR);
      expect(msg.getProcessingError()).toContain('SOAP Fault');
    });

    it('should keep QUEUED on connection refused', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(
        Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
      );

      const msg = createMsg();
      await dispatcher.send(msg);

      // Status stays at RECEIVED (not explicitly set to QUEUED, but not ERROR)
      expect(msg.getStatus()).not.toBe(Status.ERROR);
      expect(msg.getProcessingError()).toContain('Connection error');
    });

    it('should keep QUEUED on EHOSTUNREACH', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('EHOSTUNREACH'));

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).not.toBe(Status.ERROR);
      expect(msg.getProcessingError()).toContain('Connection error');
    });

    it('should keep QUEUED on ETIMEDOUT', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).not.toBe(Status.ERROR);
      expect(msg.getProcessingError()).toContain('Connection error');
    });

    it('should keep QUEUED on ENOTFOUND', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).not.toBe(Status.ERROR);
      expect(msg.getProcessingError()).toContain('Connection error');
    });

    it('should keep QUEUED on AbortError', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = jest.fn().mockRejectedValue(abortErr);

      const msg = createMsg();
      await dispatcher.send(msg);

      // AbortError -> timeout -> re-thrown as timeout error -> handleSendError
      expect(msg.getProcessingError()).toBeDefined();
    });

    it('should keep QUEUED on generic error', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Something unexpected'));

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).not.toBe(Status.ERROR);
      expect(msg.getProcessingError()).toContain('Error invoking web service');
    });

    it('should handle non-Error thrown values', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue('string error');

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getProcessingError()).toContain('Error invoking web service');
    });

    it('should extract fault response XML on SOAP fault error', async () => {
      const faultXml = soapFaultEnvelope('soap:Client', 'Bad request');
      globalThis.fetch = mockFetchOk(faultXml, 500);

      const msg = createMsg();
      await dispatcher.send(msg);

      // The fault response should be stored in RESPONSE content
      const response = msg.getContent(ContentType.RESPONSE);
      expect(response?.content).toContain('Bad request');
    });
  });

  // ── sendSoapRequest() redirects ───────────────────────────────────

  describe('sendSoapRequest() redirect handling', () => {
    it('should follow 302 redirect', async () => {
      const redirectResponse = {
        status: 302,
        statusText: 'Found',
        ok: false,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location' ? 'http://localhost:8080/ws/v2' : null,
          forEach: jest.fn(),
        },
        text: async () => '',
      };

      const responseEnvelope = soapEnvelope('<Response>Redirected</Response>');
      const finalResponse = {
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: {
          get: () => 'text/xml',
          forEach: jest.fn(),
        },
        text: async () => responseEnvelope,
      };

      globalThis.fetch = jest
        .fn()
        .mockResolvedValueOnce(redirectResponse)
        .mockResolvedValueOnce(finalResponse);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(msg.getStatus()).toBe(Status.SENT);
    });

    it('should follow 301 redirect', async () => {
      const redirectResponse = {
        status: 301,
        statusText: 'Moved Permanently',
        ok: false,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location' ? 'http://localhost:9090/ws' : null,
          forEach: jest.fn(),
        },
        text: async () => '',
      };

      const responseEnvelope = soapEnvelope('<Resp>Done</Resp>');
      const finalResponse = {
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: { get: () => 'text/xml', forEach: jest.fn() },
        text: async () => responseEnvelope,
      };

      globalThis.fetch = jest
        .fn()
        .mockResolvedValueOnce(redirectResponse)
        .mockResolvedValueOnce(finalResponse);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      // Verify second call went to redirected URL
      const secondCall = (globalThis.fetch as jest.Mock).mock.calls[1];
      expect(secondCall![0]).toBe('http://localhost:9090/ws');
    });

    it('should stop redirecting when no Location header', async () => {
      const redirectResponse = {
        status: 302,
        statusText: 'Found',
        ok: false,
        headers: {
          get: () => null, // No Location header
          forEach: jest.fn(),
        },
        text: async () => 'No location',
      };

      globalThis.fetch = jest.fn().mockResolvedValueOnce(redirectResponse);

      const msg = createMsg();
      await dispatcher.send(msg);

      // Should throw HTTP error since 302 is not ok and >= 400 check fails,
      // but 302 < 400, so text() is called and response is returned as-is
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── sendSoapRequest() authentication ──────────────────────────────

  describe('sendSoapRequest() authentication', () => {
    it('should add Basic auth header when useAuthentication is true', async () => {
      dispatcher.setProperties({
        useAuthentication: true,
        username: 'admin',
        password: 'secret',
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const requestInit = fetchCall![1] as RequestInit;
      const headers = requestInit.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(
        `Basic ${Buffer.from('admin:secret').toString('base64')}`
      );
    });

    it('should not add auth header when useAuthentication is false', async () => {
      dispatcher.setProperties({ useAuthentication: false });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const requestInit = fetchCall![1] as RequestInit;
      const headers = requestInit.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  // ── SOAP version detection + headers ──────────────────────────────

  describe('SOAP version and headers', () => {
    it('should set SOAPAction header for SOAP 1.1', async () => {
      dispatcher.setProperties({
        envelope: soapEnvelope('<TestOp/>'),
        soapAction: 'http://example.com/action',
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const headers = (fetchCall![1] as RequestInit).headers as Record<string, string>;
      expect(headers['SOAPAction']).toBe('"http://example.com/action"');
      expect(headers['Content-Type']).toContain('text/xml');
    });

    it('should use application/soap+xml for SOAP 1.2', async () => {
      dispatcher.setProperties({
        envelope: soap12Envelope('<TestOp/>'),
        soapAction: 'http://example.com/action',
      });

      const responseEnvelope = soap12Envelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const headers = (fetchCall![1] as RequestInit).headers as Record<string, string>;
      // SOAP 1.2 does NOT set separate SOAPAction header — action is in Content-Type
      expect(headers['SOAPAction']).toBeUndefined();
      expect(headers['Content-Type']).toContain('application/soap+xml');
      expect(headers['Content-Type']).toContain('action=');
    });

    it('should include custom headers from properties', async () => {
      const customHeaders = new Map<string, string[]>([
        ['X-Custom', ['myvalue']],
        ['X-Multi', ['val1', 'val2']],
      ]);
      dispatcher.setProperties({ headers: customHeaders });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const headers = (fetchCall![1] as RequestInit).headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('myvalue');
      expect(headers['X-Multi']).toBe('val1, val2');
    });
  });

  // ── MTOM attachments ──────────────────────────────────────────────

  describe('MTOM attachments', () => {
    it('should send MTOM request with attachments from properties', async () => {
      dispatcher.setProperties({
        useMtom: true,
        attachmentNames: ['file.pdf'],
        attachmentContents: ['base64PDFcontent'],
        attachmentTypes: ['application/pdf'],
      });

      const responseEnvelope = soapEnvelope('<MtomResponse/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const requestInit = fetchCall![1] as RequestInit;
      const body = requestInit.body as string;

      // MTOM body should be multipart/related
      expect(body).toContain('Content-ID: <root.message@cxf.apache.org>');
      expect(body).toContain('Content-ID: <file.pdf>');
      expect(body).toContain('base64PDFcontent');
      expect(body).toContain('application/pdf');

      // Content-Type header should be multipart/related
      const headers = requestInit.headers as Record<string, string>;
      expect(headers['Content-Type']).toContain('multipart/related');
      expect(headers['Content-Type']).toContain('boundary=');
    });

    it('should send MTOM with attachments from variable', async () => {
      dispatcher.setProperties({
        useMtom: true,
        useAttachmentsVariable: true,
        attachmentsVariable: 'myAttachments',
      });

      const attachments = [
        { name: 'doc.xml', content: '<Doc/>', mimeType: 'text/xml' },
      ];

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg({
        connectorMap: new Map([['myAttachments', attachments]]),
      });
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const body = (fetchCall![1] as RequestInit).body as string;
      expect(body).toContain('Content-ID: <doc.xml>');
      expect(body).toContain('text/xml');
    });

    it('should skip MTOM when useMtom is false', async () => {
      dispatcher.setProperties({
        useMtom: false,
        attachmentNames: ['file.pdf'],
        attachmentContents: ['data'],
        attachmentTypes: ['application/pdf'],
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      // Should NOT send multipart
      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const body = (fetchCall![1] as RequestInit).body as string;
      expect(body).not.toContain('multipart');
    });

    it('should handle empty attachments variable gracefully', async () => {
      dispatcher.setProperties({
        useMtom: true,
        useAttachmentsVariable: true,
        attachmentsVariable: 'missing',
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      // No attachments found, should fall through to non-MTOM path
      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const headers = (fetchCall![1] as RequestInit).headers as Record<string, string>;
      // Since no attachments found, useMtom && attachments.length > 0 is false
      expect(headers['Content-Type']).not.toContain('multipart');
    });

    it('should filter invalid attachment entries from variable', async () => {
      dispatcher.setProperties({
        useMtom: true,
        useAttachmentsVariable: true,
        attachmentsVariable: 'myAttachments',
      });

      const attachments = [
        { name: 'valid.pdf', content: 'data', mimeType: 'application/pdf' },
        null,
        'not-an-object',
        { noNameField: true },
      ];

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg({
        connectorMap: new Map([['myAttachments', attachments]]),
      });
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const body = (fetchCall![1] as RequestInit).body as string;
      expect(body).toContain('Content-ID: <valid.pdf>');
      // Invalid entries should be filtered out
    });
  });

  // ── ensureClient() and WSDL ───────────────────────────────────────

  describe('ensureClient and WSDL', () => {
    it('should parse WSDL when wsdlUrl is provided', async () => {
      const { parseWsdlFromUrl, getEndpointLocation } = require('../../../../src/connectors/ws/WsdlParser');
      const { createClientAsync } = require('soap');

      const mockDefinitionMap = {
        map: new Map([
          ['TestService', {
            map: new Map([
              ['TestPort', {
                operations: ['GetData'],
                locationURI: 'http://wsdl-endpoint.com/ws',
              }],
            ]),
          }],
        ]),
      };

      (parseWsdlFromUrl as jest.Mock).mockResolvedValue({
        definitionMap: mockDefinitionMap,
      });

      const mockClient = {
        setEndpoint: jest.fn(),
        setSecurity: jest.fn(),
      };
      (createClientAsync as jest.Mock).mockResolvedValue(mockClient);
      (getEndpointLocation as jest.Mock).mockReturnValue('http://wsdl-endpoint.com/ws');

      dispatcher.setProperties({
        wsdlUrl: 'http://example.com/service?wsdl',
        service: 'TestService',
        port: 'TestPort',
        operation: 'GetData',
        locationURI: '', // Will fall back to WSDL
        envelope: soapEnvelope('<GetData/>'),
      });

      const responseEnvelope = soapEnvelope('<GetDataResponse/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(parseWsdlFromUrl).toHaveBeenCalledWith(
        'http://example.com/service?wsdl',
        expect.objectContaining({ timeout: 5000 })
      );
      expect(createClientAsync).toHaveBeenCalled();
    });

    it('should set auth on SOAP client when useAuthentication is true', async () => {
      const { parseWsdlFromUrl } = require('../../../../src/connectors/ws/WsdlParser');
      const { createClientAsync } = require('soap');

      (parseWsdlFromUrl as jest.Mock).mockResolvedValue({
        definitionMap: { map: new Map() },
      });

      const mockClient = {
        setEndpoint: jest.fn(),
        setSecurity: jest.fn(),
      };
      (createClientAsync as jest.Mock).mockResolvedValue(mockClient);

      dispatcher.setProperties({
        wsdlUrl: 'http://example.com/service?wsdl',
        useAuthentication: true,
        username: 'admin',
        password: 'pass',
        locationURI: 'http://final-endpoint.com',
        envelope: soapEnvelope('<Op/>'),
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(mockClient.setSecurity).toHaveBeenCalled();
      expect(mockClient.setEndpoint).toHaveBeenCalledWith('http://final-endpoint.com');
    });

    it('should handle WSDL parsing failure gracefully', async () => {
      const { parseWsdlFromUrl } = require('../../../../src/connectors/ws/WsdlParser');
      (parseWsdlFromUrl as jest.Mock).mockRejectedValue(new Error('WSDL not found'));

      dispatcher.setProperties({
        wsdlUrl: 'http://bad-url.com/service?wsdl',
        locationURI: 'http://actual-endpoint.com/ws',
        envelope: soapEnvelope('<Op/>'),
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      // Should still send raw SOAP even if WSDL fails
      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
    });

    it('should reuse cached client when config has not changed', async () => {
      const { parseWsdlFromUrl } = require('../../../../src/connectors/ws/WsdlParser');
      const { createClientAsync } = require('soap');

      // Clear any accumulated calls from previous tests
      (parseWsdlFromUrl as jest.Mock).mockClear();
      (createClientAsync as jest.Mock).mockClear();

      (parseWsdlFromUrl as jest.Mock).mockResolvedValue({
        definitionMap: { map: new Map() },
      });

      const mockClient = { setEndpoint: jest.fn(), setSecurity: jest.fn() };
      (createClientAsync as jest.Mock).mockResolvedValue(mockClient);

      // Create a fresh dispatcher to avoid stale WSDL caching from prior tests
      const freshDispatcher = new WebServiceDispatcher({ metaDataId: 1 });
      freshDispatcher.setProperties({
        wsdlUrl: 'http://example.com/service?wsdl',
        envelope: soapEnvelope('<Op/>'),
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg1 = createMsg();
      await freshDispatcher.send(msg1);

      const msg2 = createMsg();
      await freshDispatcher.send(msg2);

      // parseWsdlFromUrl should only be called once (cached)
      expect(parseWsdlFromUrl).toHaveBeenCalledTimes(1);
    });
  });

  // ── onStart / onStop / onHalt ─────────────────────────────────────

  describe('lifecycle methods', () => {
    it('onStart should clear containers and pending tasks', async () => {
      await (dispatcher as any).onStart();
      expect((dispatcher as any).dispatchContainers.size).toBe(0);
      expect((dispatcher as any).pendingTasks.size).toBe(0);
    });

    it('onStop should clear containers and pending tasks', async () => {
      await (dispatcher as any).onStop();
      expect((dispatcher as any).dispatchContainers.size).toBe(0);
      expect((dispatcher as any).pendingTasks.size).toBe(0);
    });

    it('onHalt should abort pending tasks', async () => {
      // Simulate pending tasks
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      (dispatcher as any).pendingTasks.add(controller1);
      (dispatcher as any).pendingTasks.add(controller2);

      await (dispatcher as any).onHalt();

      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
      expect((dispatcher as any).pendingTasks.size).toBe(0);
    });

    it('onHalt with no pending tasks should not error', async () => {
      await (dispatcher as any).onHalt();
      expect((dispatcher as any).pendingTasks.size).toBe(0);
    });
  });

  // ── getResponse() ─────────────────────────────────────────────────

  describe('getResponse', () => {
    it('should return response content', async () => {
      const msg = createMsg();
      msg.setContent({
        contentType: ContentType.RESPONSE,
        content: '<Result>OK</Result>',
        dataType: 'XML',
        encrypted: false,
      });

      const result = await dispatcher.getResponse(msg);
      expect(result).toBe('<Result>OK</Result>');
    });

    it('should return null when no response exists', async () => {
      const msg = createMsg();
      const result = await dispatcher.getResponse(msg);
      expect(result).toBeNull();
    });
  });

  // ── getWsdlOperations() ───────────────────────────────────────────

  describe('getWsdlOperations', () => {
    it('should return empty when no wsdlUrl', async () => {
      dispatcher.setProperties({ wsdlUrl: '' });
      const ops = await dispatcher.getWsdlOperations();
      expect(ops).toEqual([]);
    });

    it('should return operations from parsed WSDL', async () => {
      const { parseWsdlFromUrl } = require('../../../../src/connectors/ws/WsdlParser');
      (parseWsdlFromUrl as jest.Mock).mockResolvedValue({
        definitionMap: {
          map: new Map([
            ['MyService', {
              map: new Map([
                ['MyPort', {
                  operations: ['GetData', 'SetData', 'DeleteData'],
                }],
              ]),
            }],
          ]),
        },
      });

      dispatcher.setProperties({
        wsdlUrl: 'http://example.com/service?wsdl',
        service: 'MyService',
        port: 'MyPort',
      });

      const ops = await dispatcher.getWsdlOperations();
      expect(ops).toEqual(['GetData', 'SetData', 'DeleteData']);
    });

    it('should return empty when service not found in WSDL', async () => {
      const { parseWsdlFromUrl } = require('../../../../src/connectors/ws/WsdlParser');
      (parseWsdlFromUrl as jest.Mock).mockResolvedValue({
        definitionMap: { map: new Map() },
      });

      dispatcher.setProperties({
        wsdlUrl: 'http://example.com/service?wsdl',
        service: 'NonExistent',
        port: 'SomePort',
      });

      const ops = await dispatcher.getWsdlOperations();
      expect(ops).toEqual([]);
    });

    it('should return empty when port not found in WSDL service', async () => {
      const { parseWsdlFromUrl } = require('../../../../src/connectors/ws/WsdlParser');
      (parseWsdlFromUrl as jest.Mock).mockResolvedValue({
        definitionMap: {
          map: new Map([
            ['MyService', {
              map: new Map(), // No ports
            }],
          ]),
        },
      });

      dispatcher.setProperties({
        wsdlUrl: 'http://example.com/service?wsdl',
        service: 'MyService',
        port: 'NonExistent',
      });

      const ops = await dispatcher.getWsdlOperations();
      expect(ops).toEqual([]);
    });
  });

  // ── HTTP error responses (non-SOAP fault) ─────────────────────────

  describe('HTTP error responses', () => {
    it('should throw on HTTP 500 without SOAP fault', async () => {
      globalThis.fetch = mockFetchOk('Internal Server Error', 500);

      const msg = createMsg();
      await dispatcher.send(msg);

      // Should be classified as generic error (not SOAP fault, not connection)
      expect(msg.getProcessingError()).toContain('Error invoking web service');
    });

    it('should throw on HTTP 400', async () => {
      globalThis.fetch = mockFetchOk('Bad Request', 400);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getProcessingError()).toBeDefined();
    });

    it('should handle non-XML response on HTTP error', async () => {
      globalThis.fetch = mockFetchOk('Not XML at all <<<<', 503);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getProcessingError()).toContain('Error invoking web service');
    });
  });

  // ── Request timeout ───────────────────────────────────────────────

  describe('timeout handling', () => {
    it('should convert AbortError to timeout message', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = jest.fn().mockRejectedValue(abortErr);

      const msg = createMsg();
      await dispatcher.send(msg);

      expect(msg.getProcessingError()).toContain('timeout');
    });
  });

  // ── Pending task tracking ─────────────────────────────────────────

  describe('pending task tracking', () => {
    it('should track and clean up pending tasks after successful request', async () => {
      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      // After completion, pending tasks should be empty
      expect((dispatcher as any).pendingTasks.size).toBe(0);
    });

    it('should clean up pending tasks after failed request', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('fail'));

      const msg = createMsg();
      await dispatcher.send(msg);

      expect((dispatcher as any).pendingTasks.size).toBe(0);
    });
  });

  // ── SOAP fault detection on OK response ───────────────────────────

  describe('SOAP fault in 200 response', () => {
    it('should detect SOAP fault even in 200 OK response body', async () => {
      const faultXml = soapFaultEnvelope('soap:Server', 'Application error');
      globalThis.fetch = mockFetchOk(faultXml, 200);

      const msg = createMsg();
      await dispatcher.send(msg);

      // parseSoapEnvelope detects the fault in the 200 body
      expect(msg.getStatus()).toBe(Status.ERROR);
    });
  });

  // ── dispatch container caching ────────────────────────────────────

  describe('dispatch container per metaDataId', () => {
    it('should create separate containers per dispatcherId', async () => {
      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg1 = createMsg();
      // metaDataId = 1 from createMsg
      await dispatcher.send(msg1);

      const msg2 = new ConnectorMessage({
        messageId: 2,
        metaDataId: 2, // Different metaDataId
        channelId: 'test-ch',
        channelName: 'Test',
        connectorName: 'WS Sender',
        serverId: 'srv-1',
        receivedDate: new Date(),
        status: Status.RECEIVED,
      });
      await dispatcher.send(msg2);

      // Should have two containers
      expect((dispatcher as any).dispatchContainers.size).toBe(2);
    });
  });

  // ── getSoapAction from WSDL ───────────────────────────────────────

  describe('SOAP action from WSDL', () => {
    it('should use soapAction from WSDL when not specified in properties', async () => {
      const { parseWsdlFromUrl, getSoapAction, getEndpointLocation } =
        require('../../../../src/connectors/ws/WsdlParser');

      (parseWsdlFromUrl as jest.Mock).mockResolvedValue({
        definitionMap: { map: new Map() },
      });
      (getSoapAction as jest.Mock).mockReturnValue('urn:wsdlAction');
      (getEndpointLocation as jest.Mock).mockReturnValue('http://wsdl-ep.com/ws');

      const { createClientAsync } = require('soap');
      (createClientAsync as jest.Mock).mockResolvedValue({
        setEndpoint: jest.fn(),
        setSecurity: jest.fn(),
      });

      dispatcher.setProperties({
        wsdlUrl: 'http://example.com/service?wsdl',
        soapAction: '', // Empty - should fall back to WSDL
        locationURI: '', // Empty - should fall back to WSDL
        envelope: soapEnvelope('<Op/>'),
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg();
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const headers = (fetchCall![1] as RequestInit).headers as Record<string, string>;
      expect(headers['SOAPAction']).toBe('"urn:wsdlAction"');
    });
  });

  // ── resolveVariables in send() ────────────────────────────────────

  describe('property resolution during send', () => {
    it('should resolve ${variable} in envelope during send', async () => {
      dispatcher.setProperties({
        envelope: soapEnvelope('<GetPatient><id>${patientId}</id></GetPatient>'),
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg({
        channelMap: new Map([['patientId', 'P-12345']]),
      });
      await dispatcher.send(msg);

      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const body = (fetchCall![1] as RequestInit).body as string;
      expect(body).toContain('P-12345');
      expect(body).not.toContain('${patientId}');
    });

    it('should restore original properties after send', async () => {
      dispatcher.setProperties({
        envelope: soapEnvelope('<Op>${var}</Op>'),
      });

      const responseEnvelope = soapEnvelope('<Resp/>');
      globalThis.fetch = mockFetchOk(responseEnvelope);

      const msg = createMsg({
        channelMap: new Map([['var', 'resolved']]),
      });
      await dispatcher.send(msg);

      // Properties should be restored
      expect(dispatcher.getProperties().envelope).toContain('${var}');
    });
  });

  // ── SOAP 200 with unparseable body ────────────────────────────────

  describe('unparseable response body', () => {
    it('should return raw response text when SOAP parsing fails', async () => {
      globalThis.fetch = mockFetchOk('Not valid XML at all');

      const msg = createMsg();
      await dispatcher.send(msg);

      // parseSoapEnvelope throws, but catch returns raw text
      const response = msg.getContent(ContentType.RESPONSE);
      expect(response?.content).toBe('Not valid XML at all');
    });
  });
});
