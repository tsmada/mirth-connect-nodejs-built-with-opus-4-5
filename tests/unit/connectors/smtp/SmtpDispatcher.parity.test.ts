/**
 * SMTP Dispatcher replaceConnectorProperties Parity Tests (CPC-RCP-004)
 *
 * Validates that SmtpDispatcher.replaceConnectorProperties() resolves ${variable}
 * placeholders in all connector properties, matching Java SmtpDispatcher.java line 89.
 *
 * Java reference: com.mirth.connect.connectors.smtp.SmtpDispatcher.replaceConnectorProperties()
 */

import { SmtpDispatcher } from '../../../../src/connectors/smtp/SmtpDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { ContentType } from '../../../../src/model/ContentType';
import { Status } from '../../../../src/model/Status';
import {
  SmtpDispatcherProperties,
  getDefaultSmtpDispatcherProperties,
} from '../../../../src/connectors/smtp/SmtpDispatcherProperties';
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
} from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

function createMockConnectorMessage(maps?: {
  channelMap?: Record<string, unknown>;
  connectorMap?: Record<string, unknown>;
  sourceMap?: Record<string, unknown>;
  responseMap?: Record<string, unknown>;
  rawData?: string;
  encodedData?: string;
}): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'SMTP Sender',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (maps?.rawData) {
    msg.setRawData(maps.rawData);
  }
  if (maps?.encodedData) {
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: maps.encodedData,
      dataType: 'HL7V2',
      encrypted: false,
    });
  }
  if (maps?.channelMap) {
    for (const [k, v] of Object.entries(maps.channelMap)) {
      msg.getChannelMap().set(k, v);
    }
  }
  if (maps?.connectorMap) {
    for (const [k, v] of Object.entries(maps.connectorMap)) {
      msg.getConnectorMap().set(k, v);
    }
  }
  if (maps?.sourceMap) {
    for (const [k, v] of Object.entries(maps.sourceMap)) {
      msg.getSourceMap().set(k, v);
    }
  }
  if (maps?.responseMap) {
    for (const [k, v] of Object.entries(maps.responseMap)) {
      msg.getResponseMap().set(k, v);
    }
  }

  return msg;
}

describe('SmtpDispatcher replaceConnectorProperties (CPC-RCP-004)', () => {
  let dispatcher: SmtpDispatcher;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    dispatcher = new SmtpDispatcher({
      name: 'Test SMTP',
      metaDataId: 1,
    });
  });

  describe('resolveVariables', () => {
    it('should resolve ${var} from channelMap', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        smtpHost: '${smtpServer}',
        smtpPort: '${smtpPort}',
        to: '${recipient}',
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          smtpServer: 'mail.example.com',
          smtpPort: '587',
          recipient: 'user@example.com',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.smtpHost).toBe('mail.example.com');
      expect(resolved.smtpPort).toBe('587');
      expect(resolved.to).toBe('user@example.com');
    });

    it('should resolve ${message.encodedData} and ${message.rawData}', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        body: 'Encoded: ${message.encodedData}',
        subject: 'Raw: ${message.rawData}',
      };

      const msg = createMockConnectorMessage({
        rawData: 'MSH|^~\\&|RAW',
        encodedData: 'MSH|^~\\&|ENCODED',
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.body).toBe('Encoded: MSH|^~\\&|ENCODED');
      expect(resolved.subject).toBe('Raw: MSH|^~\\&|RAW');
    });

    it('should fall back to rawData when encodedData is not available', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        body: '${message.encodedData}',
      };

      const msg = createMockConnectorMessage({
        rawData: 'MSH|^~\\&|FALLBACK',
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.body).toBe('MSH|^~\\&|FALLBACK');
    });

    it('should leave unresolved variables as-is', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        smtpHost: '${unknownVar}',
        subject: 'Hello ${name}, from ${unknownSender}',
      };

      const msg = createMockConnectorMessage({
        channelMap: { name: 'World' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.smtpHost).toBe('${unknownVar}');
      expect(resolved.subject).toBe('Hello World, from ${unknownSender}');
    });

    it('should resolve variables from sourceMap and connectorMap', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        from: '${senderEmail}',
        replyTo: '${replyAddr}',
      };

      const msg = createMockConnectorMessage({
        sourceMap: { senderEmail: 'source@example.com' },
        connectorMap: { replyAddr: 'reply@example.com' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.from).toBe('source@example.com');
      expect(resolved.replyTo).toBe('reply@example.com');
    });

    it('should not process strings without ${', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        smtpHost: 'mail.example.com',
        smtpPort: '25',
        subject: 'Plain subject',
      };

      const msg = createMockConnectorMessage();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.smtpHost).toBe('mail.example.com');
      expect(resolved.smtpPort).toBe('25');
      expect(resolved.subject).toBe('Plain subject');
    });

    it('should handle empty strings gracefully', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        smtpHost: '',
        body: '',
      };

      const msg = createMockConnectorMessage();
      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.smtpHost).toBe('');
      expect(resolved.body).toBe('');
    });
  });

  describe('replaceConnectorProperties field coverage', () => {
    it('should resolve smtpHost, smtpPort, to, from, subject, body', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        smtpHost: '${host}',
        smtpPort: '${port}',
        to: '${toAddr}',
        from: '${fromAddr}',
        subject: '${subj}',
        body: '${bodyContent}',
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          host: 'smtp.test.com',
          port: '465',
          toAddr: 'to@test.com',
          fromAddr: 'from@test.com',
          subj: 'Test Subject',
          bodyContent: '<p>Hello</p>',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.smtpHost).toBe('smtp.test.com');
      expect(resolved.smtpPort).toBe('465');
      expect(resolved.to).toBe('to@test.com');
      expect(resolved.from).toBe('from@test.com');
      expect(resolved.subject).toBe('Test Subject');
      expect(resolved.body).toBe('<p>Hello</p>');
    });

    it('should resolve cc, bcc, replyTo', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        cc: '${ccAddr}',
        bcc: '${bccAddr}',
        replyTo: '${replyAddr}',
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          ccAddr: 'cc@test.com',
          bccAddr: 'bcc@test.com',
          replyAddr: 'reply@test.com',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.cc).toBe('cc@test.com');
      expect(resolved.bcc).toBe('bcc@test.com');
      expect(resolved.replyTo).toBe('reply@test.com');
    });

    it('should resolve username and password when authentication is enabled', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        authentication: true,
        username: '${smtpUser}',
        password: '${smtpPass}',
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          smtpUser: 'admin',
          smtpPass: 's3cret',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.username).toBe('admin');
      expect(resolved.password).toBe('s3cret');
    });

    it('should NOT resolve username and password when authentication is disabled', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        authentication: false,
        username: '${smtpUser}',
        password: '${smtpPass}',
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          smtpUser: 'admin',
          smtpPass: 's3cret',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      // Java lines 99-102: only resolves if authentication is true
      expect(resolved.username).toBe('${smtpUser}');
      expect(resolved.password).toBe('${smtpPass}');
    });

    it('should resolve attachment name, content, and mimeType', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        attachments: [
          {
            name: '${attachName}',
            content: '${attachContent}',
            mimeType: '${attachType}',
          },
          {
            name: 'static.txt',
            content: 'static content',
            mimeType: 'text/plain',
          },
        ],
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          attachName: 'report.pdf',
          attachContent: 'base64data==',
          attachType: 'application/pdf',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.attachments).toHaveLength(2);
      expect(resolved.attachments[0]).toEqual({
        name: 'report.pdf',
        content: 'base64data==',
        mimeType: 'application/pdf',
      });
      // Static attachment is unchanged
      expect(resolved.attachments[1]).toEqual({
        name: 'static.txt',
        content: 'static content',
        mimeType: 'text/plain',
      });
    });

    it('should resolve header map values', () => {
      const headers = new Map<string, string>();
      headers.set('X-Custom', '${customHeaderVal}');
      headers.set('X-Static', 'static-value');

      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        headers,
      };

      const msg = createMockConnectorMessage({
        channelMap: { customHeaderVal: 'resolved-value' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.headers.get('X-Custom')).toBe('resolved-value');
      expect(resolved.headers.get('X-Static')).toBe('static-value');
    });

    it('should resolve headersVariable and attachmentsVariable', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        headersVariable: '${hdrVar}',
        attachmentsVariable: '${attVar}',
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          hdrVar: 'myHeaders',
          attVar: 'myAttachments',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.headersVariable).toBe('myHeaders');
      expect(resolved.attachmentsVariable).toBe('myAttachments');
    });

    it('should resolve localAddress, localPort, and timeout', () => {
      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        localAddress: '${localAddr}',
        localPort: '${localPrt}',
        timeout: '${timeoutMs}',
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          localAddr: '192.168.1.100',
          localPrt: '25000',
          timeoutMs: '30000',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.localAddress).toBe('192.168.1.100');
      expect(resolved.localPort).toBe('25000');
      expect(resolved.timeout).toBe('30000');
    });
  });

  describe('immutability', () => {
    it('should not modify the original properties object', () => {
      const originalHeaders = new Map<string, string>();
      originalHeaders.set('X-Test', '${val}');

      const props: SmtpDispatcherProperties = {
        ...getDefaultSmtpDispatcherProperties(),
        smtpHost: '${host}',
        to: '${recipient}',
        subject: '${subj}',
        headers: originalHeaders,
        attachments: [
          { name: '${name}', content: '${content}', mimeType: 'text/plain' },
        ],
      };

      const msg = createMockConnectorMessage({
        channelMap: {
          host: 'resolved.com',
          recipient: 'resolved@test.com',
          subj: 'Resolved',
          val: 'resolved-header',
          name: 'resolved.txt',
          content: 'resolved-content',
        },
      });

      // Capture original values
      const originalHost = props.smtpHost;
      const originalTo = props.to;
      const originalSubject = props.subject;

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      // Original should be unchanged
      expect(props.smtpHost).toBe(originalHost);
      expect(props.to).toBe(originalTo);
      expect(props.subject).toBe(originalSubject);
      expect(props.headers.get('X-Test')).toBe('${val}');
      expect(props.attachments[0]!.name).toBe('${name}');

      // Resolved should have new values
      expect(resolved.smtpHost).toBe('resolved.com');
      expect(resolved.to).toBe('resolved@test.com');
      expect(resolved.subject).toBe('Resolved');
      expect(resolved.headers.get('X-Test')).toBe('resolved-header');
      expect(resolved.attachments[0]!.name).toBe('resolved.txt');
    });
  });
});
