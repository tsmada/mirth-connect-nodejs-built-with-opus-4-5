import { HttpDispatcher } from '../../../../src/connectors/http/HttpDispatcher';
import { Channel } from '../../../../src/donkey/channel/Channel';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

describe('HttpDispatcher', () => {
  let dispatcher: HttpDispatcher;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      dispatcher = new HttpDispatcher({
        name: 'Test Dispatcher',
        metaDataId: 1,
      });

      expect(dispatcher.getName()).toBe('Test Dispatcher');
      expect(dispatcher.getMetaDataId()).toBe(1);
      expect(dispatcher.getTransportName()).toBe('HTTP');
      expect(dispatcher.isRunning()).toBe(false);

      const props = dispatcher.getProperties();
      expect(props.method).toBe('POST');
      expect(props.host).toBe('');
      expect(props.socketTimeout).toBe(30000);
    });

    it('should create with custom values', () => {
      dispatcher = new HttpDispatcher({
        name: 'Custom Dispatcher',
        metaDataId: 2,
        properties: {
          host: 'https://api.example.com/endpoint',
          method: 'PUT',
          socketTimeout: 60000,
          charset: 'ISO-8859-1',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('https://api.example.com/endpoint');
      expect(props.method).toBe('PUT');
      expect(props.socketTimeout).toBe(60000);
      expect(props.charset).toBe('ISO-8859-1');
    });
  });

  describe('properties', () => {
    beforeEach(() => {
      dispatcher = new HttpDispatcher({
        name: 'Test Dispatcher',
        metaDataId: 1,
      });
    });

    it('should get default properties', () => {
      const props = dispatcher.getProperties();

      expect(props.useAuthentication).toBe(false);
      expect(props.authenticationType).toBe('Basic');
      expect(props.usePreemptiveAuthentication).toBe(false);
      expect(props.multipart).toBe(false);
      expect(props.dataTypeBinary).toBe(false);
      expect(props.useProxyServer).toBe(false);
      expect(props.responseXmlBody).toBe(false);
    });

    it('should update properties', () => {
      dispatcher.setProperties({
        host: 'https://new-api.example.com',
        method: 'DELETE',
        useAuthentication: true,
        authenticationType: 'Digest',
        username: 'user',
        password: 'pass',
      });

      const props = dispatcher.getProperties();
      expect(props.host).toBe('https://new-api.example.com');
      expect(props.method).toBe('DELETE');
      expect(props.useAuthentication).toBe(true);
      expect(props.authenticationType).toBe('Digest');
      expect(props.username).toBe('user');
      expect(props.password).toBe('pass');
    });

    it('should set headers map', () => {
      const headers = new Map<string, string[]>();
      headers.set('X-Custom-Header', ['value1', 'value2']);
      headers.set('Authorization', ['Bearer token123']);

      dispatcher.setProperties({ headers });

      const props = dispatcher.getProperties();
      expect(props.headers.get('X-Custom-Header')).toEqual(['value1', 'value2']);
      expect(props.headers.get('Authorization')).toEqual(['Bearer token123']);
    });

    it('should set parameters map', () => {
      const parameters = new Map<string, string[]>();
      parameters.set('page', ['1']);
      parameters.set('limit', ['10']);

      dispatcher.setProperties({ parameters });

      const props = dispatcher.getProperties();
      expect(props.parameters.get('page')).toEqual(['1']);
      expect(props.parameters.get('limit')).toEqual(['10']);
    });
  });

  describe('lifecycle', () => {
    beforeEach(() => {
      dispatcher = new HttpDispatcher({
        name: 'Test Dispatcher',
        metaDataId: 1,
      });
    });

    it('should start and stop', async () => {
      await dispatcher.start();
      expect(dispatcher.isRunning()).toBe(true);

      await dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });
  });

  describe('channel association', () => {
    it('should associate with channel', () => {
      dispatcher = new HttpDispatcher({
        name: 'Test Dispatcher',
        metaDataId: 1,
      });

      const channel = new Channel({
        id: 'http-test',
        name: 'HTTP Test',
        enabled: true,
      });

      dispatcher.setChannel(channel);
      expect(dispatcher.getChannel()).toBe(channel);
    });
  });

  describe('authentication', () => {
    beforeEach(() => {
      dispatcher = new HttpDispatcher({
        name: 'Test Dispatcher',
        metaDataId: 1,
      });
    });

    it('should configure basic authentication', () => {
      dispatcher.setProperties({
        useAuthentication: true,
        authenticationType: 'Basic',
        username: 'testuser',
        password: 'testpass',
      });

      const props = dispatcher.getProperties();
      expect(props.useAuthentication).toBe(true);
      expect(props.authenticationType).toBe('Basic');
      expect(props.username).toBe('testuser');
      expect(props.password).toBe('testpass');
    });

    it('should configure digest authentication', () => {
      dispatcher.setProperties({
        useAuthentication: true,
        authenticationType: 'Digest',
        usePreemptiveAuthentication: true,
        username: 'digestuser',
        password: 'digestpass',
      });

      const props = dispatcher.getProperties();
      expect(props.authenticationType).toBe('Digest');
      expect(props.usePreemptiveAuthentication).toBe(true);
    });
  });

  describe('proxy configuration', () => {
    beforeEach(() => {
      dispatcher = new HttpDispatcher({
        name: 'Test Dispatcher',
        metaDataId: 1,
      });
    });

    it('should configure proxy', () => {
      dispatcher.setProperties({
        useProxyServer: true,
        proxyAddress: '192.168.1.100',
        proxyPort: 8888,
      });

      const props = dispatcher.getProperties();
      expect(props.useProxyServer).toBe(true);
      expect(props.proxyAddress).toBe('192.168.1.100');
      expect(props.proxyPort).toBe(8888);
    });
  });

  describe('content handling', () => {
    beforeEach(() => {
      dispatcher = new HttpDispatcher({
        name: 'Test Dispatcher',
        metaDataId: 1,
      });
    });

    it('should configure text content', () => {
      dispatcher.setProperties({
        content: '{"message": "hello"}',
        contentType: 'application/json',
        dataTypeBinary: false,
        charset: 'UTF-8',
      });

      const props = dispatcher.getProperties();
      expect(props.content).toBe('{"message": "hello"}');
      expect(props.contentType).toBe('application/json');
      expect(props.dataTypeBinary).toBe(false);
    });

    it('should configure binary content', () => {
      dispatcher.setProperties({
        content: 'SGVsbG8gV29ybGQ=', // Base64 "Hello World"
        contentType: 'application/octet-stream',
        dataTypeBinary: true,
      });

      const props = dispatcher.getProperties();
      expect(props.dataTypeBinary).toBe(true);
      expect(props.contentType).toBe('application/octet-stream');
    });

    it('should configure multipart', () => {
      dispatcher.setProperties({
        multipart: true,
        contentType: 'multipart/form-data',
      });

      const props = dispatcher.getProperties();
      expect(props.multipart).toBe(true);
    });
  });

  describe('response handling', () => {
    beforeEach(() => {
      dispatcher = new HttpDispatcher({
        name: 'Test Dispatcher',
        metaDataId: 1,
      });
    });

    it('should configure response XML body', () => {
      dispatcher.setProperties({
        responseXmlBody: true,
        responseParseMultipart: true,
        responseIncludeMetadata: true,
      });

      const props = dispatcher.getProperties();
      expect(props.responseXmlBody).toBe(true);
      expect(props.responseParseMultipart).toBe(true);
      expect(props.responseIncludeMetadata).toBe(true);
    });

    it('should configure response binary MIME types', () => {
      dispatcher.setProperties({
        responseBinaryMimeTypes: 'application/pdf|image/.*',
        responseBinaryMimeTypesRegex: true,
      });

      const props = dispatcher.getProperties();
      expect(props.responseBinaryMimeTypes).toBe('application/pdf|image/.*');
      expect(props.responseBinaryMimeTypesRegex).toBe(true);
    });
  });

  describe('HTTP methods', () => {
    it.each(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const)(
      'should configure %s method',
      (method) => {
        dispatcher = new HttpDispatcher({
          name: 'Test Dispatcher',
          metaDataId: 1,
          properties: { method },
        });

        expect(dispatcher.getProperties().method).toBe(method);
      }
    );
  });
});

describe('HttpDispatcher getResponse', () => {
  it('should return null when no response content', async () => {
    const dispatcher = new HttpDispatcher({
      name: 'Test Dispatcher',
      metaDataId: 1,
    });

    const message = new ConnectorMessage({
      messageId: 1,
      metaDataId: 1,
      channelId: 'test',
      channelName: 'Test',
      connectorName: 'Test Dispatcher',
      serverId: 'server-1',
      receivedDate: new Date(),
      status: Status.PENDING,
    });

    const response = await dispatcher.getResponse(message);
    expect(response).toBeNull();
  });

  it('should return response content when present', async () => {
    const dispatcher = new HttpDispatcher({
      name: 'Test Dispatcher',
      metaDataId: 1,
    });

    const message = new ConnectorMessage({
      messageId: 1,
      metaDataId: 1,
      channelId: 'test',
      channelName: 'Test',
      connectorName: 'Test Dispatcher',
      serverId: 'server-1',
      receivedDate: new Date(),
      status: Status.SENT,
    });

    message.setContent({
      contentType: ContentType.RESPONSE,
      content: '<ack>OK</ack>',
      dataType: 'XML',
      encrypted: false,
    });

    const response = await dispatcher.getResponse(message);
    expect(response).toBe('<ack>OK</ack>');
  });
});
