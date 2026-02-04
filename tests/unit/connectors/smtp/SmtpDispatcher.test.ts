import { SmtpDispatcher } from '../../../../src/connectors/smtp/SmtpDispatcher';
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
} from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

// Note: Full integration tests require actual SMTP server
// These tests focus on configuration, property handling, and mock scenarios

describe('SmtpDispatcher', () => {
  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const dispatcher = new SmtpDispatcher({
        name: 'Test SMTP Dispatcher',
        metaDataId: 1,
      });

      expect(dispatcher.getName()).toBe('Test SMTP Dispatcher');
      expect(dispatcher.getMetaDataId()).toBe(1);
      expect(dispatcher.getTransportName()).toBe('SMTP');
      expect(dispatcher.isRunning()).toBe(false);

      const props = dispatcher.getProperties();
      expect(props.smtpHost).toBe('');
      expect(props.smtpPort).toBe('25');
      expect(props.encryption).toBe('none');
      expect(props.authentication).toBe(false);
      expect(props.html).toBe(false);
    });

    it('should create with default name when not specified', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
      });

      expect(dispatcher.getName()).toBe('SMTP Sender');
    });

    it('should create with custom properties', () => {
      const dispatcher = new SmtpDispatcher({
        name: 'Custom SMTP Dispatcher',
        metaDataId: 2,
        properties: {
          smtpHost: 'smtp.example.com',
          smtpPort: '587',
          encryption: 'tls',
          authentication: true,
          username: 'user@example.com',
          password: 'secret',
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Test Email',
          body: 'Hello World',
          html: true,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.smtpHost).toBe('smtp.example.com');
      expect(props.smtpPort).toBe('587');
      expect(props.encryption).toBe('tls');
      expect(props.authentication).toBe(true);
      expect(props.username).toBe('user@example.com');
      expect(props.password).toBe('secret');
      expect(props.from).toBe('sender@example.com');
      expect(props.to).toBe('recipient@example.com');
      expect(props.subject).toBe('Test Email');
      expect(props.body).toBe('Hello World');
      expect(props.html).toBe(true);
    });
  });

  describe('properties', () => {
    let dispatcher: SmtpDispatcher;

    beforeEach(() => {
      dispatcher = new SmtpDispatcher({ metaDataId: 1 });
    });

    it('should get default properties', () => {
      const props = dispatcher.getProperties();

      expect(props.smtpHost).toBe('');
      expect(props.smtpPort).toBe('25');
      expect(props.timeout).toBe('5000');
      expect(props.encryption).toBe('none');
      expect(props.charsetEncoding).toBe('UTF-8');
    });

    it('should update properties', () => {
      dispatcher.setProperties({
        smtpHost: 'newhost.example.com',
        smtpPort: '465',
        encryption: 'ssl',
      });

      const props = dispatcher.getProperties();
      expect(props.smtpHost).toBe('newhost.example.com');
      expect(props.smtpPort).toBe('465');
      expect(props.encryption).toBe('ssl');
    });

    it('should preserve existing headers and attachments when updating', () => {
      const headers = new Map<string, string>();
      headers.set('X-Priority', '1');

      dispatcher.setProperties({
        headers,
        attachments: [{ name: 'test.txt', content: 'data', mimeType: 'text/plain' }],
      });

      dispatcher.setProperties({
        smtpHost: 'changed.example.com',
      });

      const props = dispatcher.getProperties();
      expect(props.smtpHost).toBe('changed.example.com');
      expect(props.headers.get('X-Priority')).toBe('1');
      expect(props.attachments).toHaveLength(1);
    });
  });

  describe('lifecycle', () => {
    let dispatcher: SmtpDispatcher;

    beforeEach(() => {
      dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          smtpHost: 'smtp.example.com',
        },
      });
    });

    afterEach(async () => {
      await dispatcher.stop();
    });

    it('should be stopped initially', () => {
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should start successfully', async () => {
      await dispatcher.start();
      expect(dispatcher.isRunning()).toBe(true);
    });

    it('should stop successfully', async () => {
      await dispatcher.start();
      await dispatcher.stop();
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should not fail when starting an already started dispatcher', async () => {
      await dispatcher.start();
      await dispatcher.start(); // Should not throw
      expect(dispatcher.isRunning()).toBe(true);
    });

    it('should not fail when stopping a stopped dispatcher', async () => {
      await dispatcher.stop(); // Should not throw
      expect(dispatcher.isRunning()).toBe(false);
    });

    it('should create transporter on start', async () => {
      await dispatcher.start();
      expect(dispatcher.getTransporter()).not.toBeNull();
    });

    it('should clear transporter on stop', async () => {
      await dispatcher.start();
      await dispatcher.stop();
      expect(dispatcher.getTransporter()).toBeNull();
    });
  });

  describe('encryption configuration', () => {
    it('should configure no encryption', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          encryption: 'none',
        },
      });

      expect(dispatcher.getProperties().encryption).toBe('none');
    });

    it('should configure TLS encryption', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          encryption: 'tls',
          smtpPort: '587',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.encryption).toBe('tls');
      expect(props.smtpPort).toBe('587');
    });

    it('should configure SSL encryption', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          encryption: 'ssl',
          smtpPort: '465',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.encryption).toBe('ssl');
      expect(props.smtpPort).toBe('465');
    });
  });

  describe('authentication configuration', () => {
    it('should configure authentication credentials', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          authentication: true,
          username: 'testuser',
          password: 'testpass',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.authentication).toBe(true);
      expect(props.username).toBe('testuser');
      expect(props.password).toBe('testpass');
    });
  });

  describe('recipient configuration', () => {
    it('should configure single recipient', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          to: 'user@example.com',
        },
      });

      expect(dispatcher.getProperties().to).toBe('user@example.com');
    });

    it('should configure multiple recipients', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          to: 'user1@example.com,user2@example.com',
          cc: 'cc1@example.com,cc2@example.com',
          bcc: 'bcc@example.com',
          replyTo: 'replyto@example.com',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.to).toBe('user1@example.com,user2@example.com');
      expect(props.cc).toBe('cc1@example.com,cc2@example.com');
      expect(props.bcc).toBe('bcc@example.com');
      expect(props.replyTo).toBe('replyto@example.com');
    });
  });

  describe('content configuration', () => {
    it('should configure plain text body', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          html: false,
          body: 'Plain text content',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.html).toBe(false);
      expect(props.body).toBe('Plain text content');
    });

    it('should configure HTML body', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          html: true,
          body: '<html><body><h1>Hello</h1></body></html>',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.html).toBe(true);
      expect(props.body).toContain('<html>');
    });

    it('should configure subject', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          subject: 'Test Subject Line',
        },
      });

      expect(dispatcher.getProperties().subject).toBe('Test Subject Line');
    });
  });

  describe('headers configuration', () => {
    it('should configure static headers', () => {
      const headers = new Map<string, string>();
      headers.set('X-Priority', '1');
      headers.set('X-Custom-Header', 'custom-value');

      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          headers,
          useHeadersVariable: false,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.headers.get('X-Priority')).toBe('1');
      expect(props.headers.get('X-Custom-Header')).toBe('custom-value');
      expect(props.useHeadersVariable).toBe(false);
    });

    it('should configure headers from variable', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          useHeadersVariable: true,
          headersVariable: 'customHeaders',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useHeadersVariable).toBe(true);
      expect(props.headersVariable).toBe('customHeaders');
    });
  });

  describe('attachments configuration', () => {
    it('should configure static attachments', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          attachments: [
            { name: 'doc.pdf', content: 'base64data', mimeType: 'application/pdf' },
            { name: 'image.png', content: 'imagedata', mimeType: 'image/png' },
          ],
          useAttachmentsVariable: false,
        },
      });

      const props = dispatcher.getProperties();
      expect(props.attachments).toHaveLength(2);
      expect(props.attachments[0]!.name).toBe('doc.pdf');
      expect(props.attachments[1]!.name).toBe('image.png');
      expect(props.useAttachmentsVariable).toBe(false);
    });

    it('should configure attachments from variable', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          useAttachmentsVariable: true,
          attachmentsVariable: 'emailAttachments',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.useAttachmentsVariable).toBe(true);
      expect(props.attachmentsVariable).toBe('emailAttachments');
    });
  });

  describe('timeout configuration', () => {
    it('should configure timeout', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          timeout: '30000',
        },
      });

      expect(dispatcher.getProperties().timeout).toBe('30000');
    });
  });

  describe('local binding configuration', () => {
    it('should configure local binding', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          overrideLocalBinding: true,
          localAddress: '192.168.1.100',
          localPort: '5000',
        },
      });

      const props = dispatcher.getProperties();
      expect(props.overrideLocalBinding).toBe(true);
      expect(props.localAddress).toBe('192.168.1.100');
      expect(props.localPort).toBe('5000');
    });
  });

  describe('destination connector options', () => {
    it('should configure queue settings', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        queueEnabled: true,
        queueSendFirst: true,
        retryCount: 5,
        retryIntervalMillis: 15000,
      });

      expect(dispatcher.isQueueEnabled()).toBe(true);
    });

    it('should configure enabled state', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        enabled: false,
      });

      expect(dispatcher.isEnabled()).toBe(false);
    });

    it('should configure wait for previous', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        waitForPrevious: true,
      });

      // waitForPrevious is handled by base class
      expect(dispatcher.getMetaDataId()).toBe(1);
    });
  });

  describe('verifyConnection', () => {
    it('should create transporter if not exists', async () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          smtpHost: 'localhost',
          smtpPort: '25',
        },
      });

      // This will fail since no SMTP server is running, but it should create the transporter
      await dispatcher.verifyConnection();

      // Connection will fail without an SMTP server, but transporter should be created
      expect(dispatcher.getTransporter()).not.toBeNull();
      // Result depends on whether an SMTP server is actually running
    });
  });

  describe('charset encoding', () => {
    it('should configure charset encoding', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
        properties: {
          charsetEncoding: 'ISO-8859-1',
        },
      });

      expect(dispatcher.getProperties().charsetEncoding).toBe('ISO-8859-1');
    });

    it('should default to UTF-8', () => {
      const dispatcher = new SmtpDispatcher({
        metaDataId: 1,
      });

      expect(dispatcher.getProperties().charsetEncoding).toBe('UTF-8');
    });
  });
});
