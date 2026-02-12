/**
 * SMTP Dispatcher Parity Tests — Wave 19
 *
 * CPC-W19-005 (Major): Missing ErrorEvent dispatch on send failure
 * CPC-W19-008 (Minor): Missing localPort in overrideLocalBinding
 *
 * Java reference: com.mirth.connect.connectors.smtp.SmtpDispatcher.java
 */

import { SmtpDispatcher } from '../../../../src/connectors/smtp/SmtpDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ConnectionStatusEventType } from '../../../../src/plugins/dashboardstatus/ConnectionLogItem';
import {
  ErrorEventType,
  setAlertEventController,
  type ErrorEvent,
  type IEventController,
} from '../../../../src/javascript/userutil/AlertSender';
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
} from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import nodemailer from 'nodemailer';

// Mock nodemailer
jest.mock('nodemailer');

// Track dispatched dashboard events
const dashboardEvents: Array<{ state: ConnectionStatusEventType; message?: string }> = [];

// Mock dashboardStatusController
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: jest.fn((event: { state: ConnectionStatusEventType; message?: string }) => {
      dashboardEvents.push({ state: event.state, message: event.message });
    }),
  },
}));

// Track dispatched error events
const errorEvents: ErrorEvent[] = [];

function createMockConnectorMessage(maps?: {
  channelMap?: Record<string, unknown>;
}): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 42,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'SMTP Sender',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (maps?.channelMap) {
    for (const [k, v] of Object.entries(maps.channelMap)) {
      msg.getChannelMap().set(k, v);
    }
  }

  return msg;
}

describe('SmtpDispatcher Wave 19 Parity Fixes', () => {
  let dispatcher: SmtpDispatcher;
  let mockTransporter: {
    sendMail: jest.Mock;
    close: jest.Mock;
    verify: jest.Mock;
  };
  let mockEventController: IEventController;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
    dashboardEvents.length = 0;
    errorEvents.length = 0;

    // Set up mock event controller for ErrorEvent capture
    mockEventController = {
      dispatchEvent: jest.fn((event: ErrorEvent) => {
        errorEvents.push(event);
      }),
    };
    setAlertEventController(mockEventController);

    mockTransporter = {
      sendMail: jest.fn(),
      close: jest.fn(),
      verify: jest.fn(),
    };

    (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

    dispatcher = new SmtpDispatcher({
      name: 'Test SMTP',
      metaDataId: 1,
      properties: {
        smtpHost: 'mail.test.com',
        smtpPort: '25',
        to: 'test@test.com',
        from: 'sender@test.com',
        subject: 'Test',
        body: 'Hello',
      },
    });

    // Wire channel so dispatchConnectionEvent and ErrorEvent have channelId
    const mockChannel = {
      getId: () => 'test-channel',
      getName: () => 'Test Channel',
      emit: jest.fn(),
    };
    (dispatcher as unknown as { channel: unknown }).channel = mockChannel;
    (dispatcher as unknown as { running: boolean }).running = true;
  });

  describe('CPC-W19-005: ErrorEvent dispatch on send failure', () => {
    it('should dispatch ErrorEvent with DESTINATION_CONNECTOR type on send failure', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('Connection refused'));

      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow('Connection refused');

      // Verify ErrorEvent was dispatched
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toEqual(
        expect.objectContaining({
          channelId: 'test-channel',
          metaDataId: 1,
          messageId: 42,
          eventType: ErrorEventType.DESTINATION_CONNECTOR,
          connectorName: 'Test SMTP',
        })
      );
      expect(errorEvents[0]!.errorMessage).toContain('Error sending email message');
      expect(errorEvents[0]!.errorMessage).toContain('Connection refused');
    });

    it('should dispatch ErrorEvent with the connector name matching Java getDestinationName()', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('Auth failed'));

      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow('Auth failed');

      expect(errorEvents[0]!.connectorName).toBe('Test SMTP');
    });

    it('should dispatch ErrorEvent AND IDLE ConnectionStatusEvent on failure', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('Timeout'));

      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow('Timeout');

      // ErrorEvent dispatched
      expect(errorEvents).toHaveLength(1);

      // IDLE event dispatched in finally block (existing behavior)
      const idleEvents = dashboardEvents.filter((e) => e.state === ConnectionStatusEventType.IDLE);
      expect(idleEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should not dispatch ErrorEvent on success', async () => {
      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<abc@test.com>',
        accepted: ['test@test.com'],
      });

      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      expect(errorEvents).toHaveLength(0);
    });

    it('should include messageId from ConnectorMessage in the ErrorEvent', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('SMTP error'));

      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow();

      expect(errorEvents[0]!.messageId).toBe(42);
    });
  });

  describe('CPC-W19-008: localPort in overrideLocalBinding', () => {
    it('should set localPort when overrideLocalBinding is true and localPort is valid', async () => {
      const dispatcherWithBinding = new SmtpDispatcher({
        name: 'SMTP with binding',
        metaDataId: 1,
        properties: {
          smtpHost: 'mail.test.com',
          smtpPort: '25',
          to: 'test@test.com',
          from: 'sender@test.com',
          subject: 'Test',
          body: 'Hello',
          overrideLocalBinding: true,
          localAddress: '192.168.1.100',
          localPort: '25000',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      (dispatcherWithBinding as unknown as { channel: unknown }).channel = mockChannel;
      (dispatcherWithBinding as unknown as { running: boolean }).running = true;

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<abc@test.com>',
      });

      const msg = createMockConnectorMessage();
      await dispatcherWithBinding.send(msg);

      // Verify createTransport was called with localAddress AND localPort
      const createTransportCall = (nodemailer.createTransport as jest.Mock).mock.calls;
      const lastCall = createTransportCall[createTransportCall.length - 1]![0];

      expect(lastCall.localAddress).toBe('192.168.1.100');
      expect(lastCall.localPort).toBe(25000);
    });

    it('should set localAddress but NOT localPort when localPort is "0" (default)', async () => {
      const dispatcherWithBinding = new SmtpDispatcher({
        name: 'SMTP with binding',
        metaDataId: 1,
        properties: {
          smtpHost: 'mail.test.com',
          smtpPort: '25',
          to: 'test@test.com',
          from: 'sender@test.com',
          subject: 'Test',
          body: 'Hello',
          overrideLocalBinding: true,
          localAddress: '192.168.1.100',
          localPort: '0',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      (dispatcherWithBinding as unknown as { channel: unknown }).channel = mockChannel;
      (dispatcherWithBinding as unknown as { running: boolean }).running = true;

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<abc@test.com>',
      });

      const msg = createMockConnectorMessage();
      await dispatcherWithBinding.send(msg);

      const createTransportCall = (nodemailer.createTransport as jest.Mock).mock.calls;
      const lastCall = createTransportCall[createTransportCall.length - 1]![0];

      expect(lastCall.localAddress).toBe('192.168.1.100');
      // localPort should NOT be set when value is 0 (default — let OS choose)
      expect(lastCall.localPort).toBeUndefined();
    });

    it('should not set localAddress or localPort when overrideLocalBinding is false', async () => {
      const dispatcherNoBinding = new SmtpDispatcher({
        name: 'SMTP no binding',
        metaDataId: 1,
        properties: {
          smtpHost: 'mail.test.com',
          smtpPort: '25',
          to: 'test@test.com',
          from: 'sender@test.com',
          subject: 'Test',
          body: 'Hello',
          overrideLocalBinding: false,
          localAddress: '192.168.1.100',
          localPort: '25000',
        },
      });

      const mockChannel = {
        getId: () => 'test-channel',
        getName: () => 'Test Channel',
        emit: jest.fn(),
      };
      (dispatcherNoBinding as unknown as { channel: unknown }).channel = mockChannel;
      (dispatcherNoBinding as unknown as { running: boolean }).running = true;

      mockTransporter.sendMail.mockResolvedValue({
        messageId: '<abc@test.com>',
      });

      const msg = createMockConnectorMessage();
      await dispatcherNoBinding.send(msg);

      const createTransportCall = (nodemailer.createTransport as jest.Mock).mock.calls;
      const lastCall = createTransportCall[createTransportCall.length - 1]![0];

      expect(lastCall.localAddress).toBeUndefined();
      expect(lastCall.localPort).toBeUndefined();
    });

    it('should resolve ${var} in localPort via replaceConnectorProperties', () => {
      const props = {
        ...({} as import('../../../../src/connectors/smtp/SmtpDispatcherProperties').SmtpDispatcherProperties),
        smtpHost: 'mail.test.com',
        smtpPort: '25',
        overrideLocalBinding: true,
        localAddress: '0.0.0.0',
        localPort: '${myLocalPort}',
        timeout: '5000',
        encryption: 'none' as const,
        authentication: false,
        username: '',
        password: '',
        to: '',
        from: '',
        cc: '',
        bcc: '',
        replyTo: '',
        headers: new Map<string, string>(),
        headersVariable: '',
        useHeadersVariable: false,
        subject: '',
        charsetEncoding: 'UTF-8',
        html: false,
        body: '',
        attachments: [],
        attachmentsVariable: '',
        useAttachmentsVariable: false,
        dataType: 'RAW',
      };

      const msg = createMockConnectorMessage({
        channelMap: { myLocalPort: '12345' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.localPort).toBe('12345');
    });
  });
});
