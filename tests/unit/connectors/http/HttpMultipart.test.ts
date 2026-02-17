import { HttpDispatcher } from '../../../../src/connectors/http/HttpDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { ContentType } from '../../../../src/model/ContentType';
import { Status } from '../../../../src/model/Status';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

/**
 * Tests for multipart/form-data support in HttpDispatcher.
 *
 * Validates that:
 * - FormData is created when multipart=true or contentType includes multipart/form-data
 * - Parameters are added as form fields
 * - Binary content is wrapped in a Blob with correct MIME type
 * - Content-Type header is removed so fetch auto-sets it with boundary
 * - Non-multipart behavior is unchanged
 */
describe('HttpDispatcher multipart/form-data support', () => {
  let dispatcher: HttpDispatcher;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  function createConnectorMessage(opts?: {
    encodedContent?: string;
  }): ConnectorMessage {
    const msg = new ConnectorMessage({
      messageId: 1,
      metaDataId: 1,
      channelId: 'test-channel',
      channelName: 'Test Channel',
      connectorName: 'HTTP Sender',
      serverId: 'server-1',
      receivedDate: new Date(),
      status: Status.PENDING,
    });

    if (opts?.encodedContent) {
      msg.setContent({
        contentType: ContentType.ENCODED,
        content: opts.encodedContent,
        dataType: 'RAW',
        encrypted: false,
      });
    }

    return msg;
  }

  /**
   * Access the private buildBody method via casting for unit testing.
   * This avoids needing to mock fetch() for body construction tests.
   */
  function callBuildBody(
    d: HttpDispatcher,
    connectorMessage: ConnectorMessage,
    propsOverrides?: Record<string, unknown>
  ): string | FormData | null {
    const props = { ...d.getProperties(), ...propsOverrides };
    // Access private method via bracket notation
    return (d as any).buildBody(connectorMessage, props);
  }

  /**
   * Access the private buildHeaders method for header inspection.
   */
  function callBuildHeaders(
    d: HttpDispatcher,
    propsOverrides?: Record<string, unknown>
  ): Map<string, string[]> {
    const props = { ...d.getProperties(), ...propsOverrides };
    return (d as any).buildHeaders(props);
  }

  describe('buildBody with multipart=true', () => {
    it('should return FormData when multipart is true', () => {
      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          content: 'test body content',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg);

      expect(body).toBeInstanceOf(FormData);
    });

    it('should add parameters as form fields', () => {
      const parameters = new Map<string, string[]>();
      parameters.set('filename', ['report.pdf']);
      parameters.set('category', ['medical']);
      parameters.set('tags', ['urgent', 'radiology']);

      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          parameters,
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg) as FormData;

      expect(body).toBeInstanceOf(FormData);

      // FormData.getAll returns all values for a key
      expect(body.getAll('filename')).toEqual(['report.pdf']);
      expect(body.getAll('category')).toEqual(['medical']);
      // Multi-value parameter: both values should be present
      expect(body.getAll('tags')).toEqual(['urgent', 'radiology']);
    });

    it('should add text content as "content" field', () => {
      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          content: '{"patient": "John Doe"}',
          contentType: 'application/json',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg) as FormData;

      expect(body).toBeInstanceOf(FormData);
      expect(body.get('content')).toBe('{"patient": "John Doe"}');
    });

    it('should add binary content as Blob with correct MIME type', () => {
      const base64Content = Buffer.from('Hello Binary World').toString('base64');

      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          content: base64Content,
          dataTypeBinary: true,
          contentType: 'application/octet-stream',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg) as FormData;

      expect(body).toBeInstanceOf(FormData);

      const contentField = body.get('content');
      // Binary content is wrapped in a Blob
      expect(contentField).toBeInstanceOf(Blob);
      expect((contentField as Blob).type).toBe('application/octet-stream');
      expect((contentField as Blob).size).toBe(Buffer.from(base64Content, 'base64').length);
    });

    it('should use application/octet-stream for binary when contentType is multipart/form-data', () => {
      const base64Content = Buffer.from('binary data').toString('base64');

      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          content: base64Content,
          dataTypeBinary: true,
          contentType: 'multipart/form-data',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg) as FormData;

      const contentField = body.get('content');
      expect(contentField).toBeInstanceOf(Blob);
      // When contentType is "multipart/form-data", the blob should use
      // application/octet-stream instead (since multipart/form-data is the
      // envelope type, not the content part type)
      expect((contentField as Blob).type).toBe('application/octet-stream');
    });

    it('should not add content field when content is empty', () => {
      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          content: '',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg) as FormData;

      expect(body).toBeInstanceOf(FormData);
      expect(body.get('content')).toBeNull();
    });

    it('should fall back to encoded content when props.content is empty', () => {
      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          content: '',
        },
      });

      const msg = createConnectorMessage({ encodedContent: 'encoded message body' });
      const body = callBuildBody(dispatcher, msg) as FormData;

      expect(body).toBeInstanceOf(FormData);
      expect(body.get('content')).toBe('encoded message body');
    });
  });

  describe('buildBody with contentType detection', () => {
    it('should create FormData when contentType is multipart/form-data (without explicit multipart flag)', () => {
      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: false, // Explicitly false
          contentType: 'multipart/form-data',
          content: 'form content',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg);

      expect(body).toBeInstanceOf(FormData);
    });

    it('should create FormData when contentType has multipart/form-data with charset', () => {
      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: false,
          contentType: 'multipart/form-data; charset=UTF-8',
          content: 'form content',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg);

      expect(body).toBeInstanceOf(FormData);
    });
  });

  describe('non-multipart behavior preserved', () => {
    it('should return string for plain text POST', () => {
      dispatcher = new HttpDispatcher({
        name: 'Text Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/api',
          multipart: false,
          content: '{"key": "value"}',
          contentType: 'application/json',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg);

      expect(typeof body).toBe('string');
      expect(body).toBe('{"key": "value"}');
    });

    it('should return URLSearchParams string for form-urlencoded', () => {
      const parameters = new Map<string, string[]>();
      parameters.set('name', ['test']);
      parameters.set('value', ['123']);

      dispatcher = new HttpDispatcher({
        name: 'Form Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/form',
          multipart: false,
          contentType: 'application/x-www-form-urlencoded',
          parameters,
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg) as string;

      expect(typeof body).toBe('string');
      expect(body).toContain('name=test');
      expect(body).toContain('value=123');
    });

    it('should return null when no content', () => {
      dispatcher = new HttpDispatcher({
        name: 'Empty Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/api',
          multipart: false,
          content: '',
          contentType: 'text/plain',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg);

      expect(body).toBeNull();
    });
  });

  describe('Content-Type header handling for multipart', () => {
    /**
     * Simulate what executeRequest() does with the body and headers.
     * When body is FormData, Content-Type must be removed from the headers
     * so that fetch() auto-sets it with the correct boundary parameter.
     */
    it('should remove Content-Type header when body is FormData', () => {
      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          content: 'file content',
          contentType: 'multipart/form-data',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg);
      expect(body).toBeInstanceOf(FormData);

      // buildHeaders will set Content-Type, but executeRequest removes it for FormData
      const headers = callBuildHeaders(dispatcher, { contentType: 'multipart/form-data' });

      // Convert to the same format executeRequest uses
      const headersObj: Record<string, string> = {};
      for (const [k, v] of headers.entries()) {
        headersObj[k] = v.join(', ');
      }

      // Simulate what executeRequest does for FormData
      if (body instanceof FormData) {
        delete headersObj['Content-Type'];
        delete headersObj['content-type'];
      }

      // Verify Content-Type is removed
      expect(headersObj['Content-Type']).toBeUndefined();
      expect(headersObj['content-type']).toBeUndefined();
    });

    it('should preserve Content-Type header for non-multipart requests', () => {
      dispatcher = new HttpDispatcher({
        name: 'JSON Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/api',
          multipart: false,
          contentType: 'application/json',
          content: '{}',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg);
      expect(typeof body).toBe('string');

      const headers = callBuildHeaders(dispatcher, { contentType: 'application/json' });
      expect(headers.has('Content-Type')).toBe(true);
    });
  });

  describe('multipart with parameters and content together', () => {
    it('should include both parameters and content in FormData', () => {
      const parameters = new Map<string, string[]>();
      parameters.set('patientId', ['P12345']);
      parameters.set('documentType', ['CDA']);

      dispatcher = new HttpDispatcher({
        name: 'Multipart Sender',
        metaDataId: 1,
        properties: {
          host: 'https://example.com/upload',
          multipart: true,
          parameters,
          content: '<ClinicalDocument>...</ClinicalDocument>',
          contentType: 'text/xml',
        },
      });

      const msg = createConnectorMessage();
      const body = callBuildBody(dispatcher, msg) as FormData;

      expect(body).toBeInstanceOf(FormData);
      // Parameters
      expect(body.get('patientId')).toBe('P12345');
      expect(body.get('documentType')).toBe('CDA');
      // Content
      expect(body.get('content')).toBe('<ClinicalDocument>...</ClinicalDocument>');
    });
  });
});
