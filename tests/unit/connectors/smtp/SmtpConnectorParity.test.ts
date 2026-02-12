/**
 * SMTP Connector Parity Tests
 *
 * Tests for 5 parity gaps between Java and Node.js SMTP dispatcher:
 * - CPC-SMTP-001 (Critical): Connection event dispatching (WRITING/IDLE/Error)
 * - CPC-SMTP-002 (Critical): QUEUED status on transient failures
 * - CPC-SMTP-003 (Major): Per-message connection (not persistent transporter)
 * - CPC-SMTP-004 (Major): MessageMaps lookup order for headers/attachments variables
 * - CPC-SMTP-005 (Major): reAttachMessage() for body content
 *
 * Java reference: com.mirth.connect.connectors.smtp.SmtpDispatcher.java
 */

import { SmtpDispatcher } from '../../../../src/connectors/smtp/SmtpDispatcher';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ConnectionStatusEventType } from '../../../../src/plugins/dashboardstatus/ConnectionLogItem';
// dashboardStatusController is mocked below
import {
  GlobalMap,
  ConfigurationMap,
  GlobalChannelMapStore,
} from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';
import {
  ErrorEventType,
  setAlertEventController,
  type ErrorEvent,
  type IEventController,
} from '../../../../src/javascript/userutil/AlertSender';
import nodemailer from 'nodemailer';

// Mock nodemailer
jest.mock('nodemailer');

// Track dispatched events
const dispatchedEvents: Array<{ state: ConnectionStatusEventType; message?: string }> = [];

// Track dispatched error events (CPC-W19-005)
const errorEvents: ErrorEvent[] = [];

// Mock dashboardStatusController.processEvent
jest.mock('../../../../src/plugins/dashboardstatus/DashboardStatusController', () => ({
  dashboardStatusController: {
    processEvent: jest.fn((event: { state: ConnectionStatusEventType; message?: string }) => {
      dispatchedEvents.push({ state: event.state, message: event.message });
    }),
  },
}));

function createMockConnectorMessage(maps?: {
  channelMap?: Record<string, unknown>;
  connectorMap?: Record<string, unknown>;
  sourceMap?: Record<string, unknown>;
  responseMap?: Record<string, unknown>;
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

describe('SMTP Connector Parity Tests', () => {
  let mockSendMail: jest.Mock;
  let mockClose: jest.Mock;
  let mockVerify: jest.Mock;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
    dispatchedEvents.length = 0;
    errorEvents.length = 0;

    // Set up mock event controller for ErrorEvent capture (CPC-W19-005)
    const mockEventController: IEventController = {
      dispatchEvent: jest.fn((event: ErrorEvent) => {
        errorEvents.push(event);
      }),
    };
    setAlertEventController(mockEventController);

    mockSendMail = jest.fn().mockResolvedValue({
      messageId: '<test-msg-id@example.com>',
      accepted: ['to@example.com'],
      rejected: [],
      response: '250 OK',
    });
    mockClose = jest.fn();
    mockVerify = jest.fn().mockResolvedValue(true);

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
      close: mockClose,
      verify: mockVerify,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // CPC-SMTP-001: Connection event dispatching
  // --------------------------------------------------------------------------

  describe('CPC-SMTP-001: Connection event dispatching', () => {
    it('should dispatch WRITING event before send', async () => {
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      expect(dispatchedEvents[0]).toEqual({
        state: ConnectionStatusEventType.WRITING,
        message: expect.stringContaining('SMTP Info:'),
      });
    });

    it('should dispatch IDLE event in finally (after success)', async () => {
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      const lastEvent = dispatchedEvents[dispatchedEvents.length - 1]!;
      expect(lastEvent.state).toBe(ConnectionStatusEventType.IDLE);
    });

    it('should dispatch IDLE event in finally (after error)', async () => {
      mockSendMail.mockRejectedValue(new Error('Connection refused'));
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow('Connection refused');

      const lastEvent = dispatchedEvents[dispatchedEvents.length - 1]!;
      expect(lastEvent.state).toBe(ConnectionStatusEventType.IDLE);
    });

    it('should dispatch ErrorEvent on failure via alert event controller (CPC-W19-005)', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP auth failed'));
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow();

      // CPC-W19-005: Error now dispatched as ErrorEvent (alert system), not ConnectionStatusEvent.INFO
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.eventType).toBe(ErrorEventType.DESTINATION_CONNECTOR);
      expect(errorEvents[0]!.errorMessage).toContain('Error sending email message');
      expect(errorEvents[0]!.errorMessage).toContain('SMTP auth failed');
    });

    it('should dispatch WRITING with info string matching Java format', async () => {
      const dispatcher = createDispatcherWithChannel({
        smtpHost: 'smtp.company.com',
        smtpPort: '587',
        from: 'noreply@company.com',
        to: 'user@company.com',
      });
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      expect(dispatchedEvents[0]!.message).toBe(
        'From: noreply@company.com To: user@company.com SMTP Info: smtp.company.com:587'
      );
    });
  });

  // --------------------------------------------------------------------------
  // CPC-SMTP-002: QUEUED status on transient failures
  // --------------------------------------------------------------------------

  describe('CPC-SMTP-002: QUEUED on transient failures', () => {
    it('should set QUEUED status when queue enabled and send fails', async () => {
      mockSendMail.mockRejectedValue(new Error('Connection timed out'));
      const dispatcher = createDispatcherWithChannel({}, { queueEnabled: true });
      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow();

      expect(msg.getStatus()).toBe(Status.QUEUED);
    });

    it('should set ERROR status when queue disabled and send fails', async () => {
      mockSendMail.mockRejectedValue(new Error('Connection timed out'));
      const dispatcher = createDispatcherWithChannel({}, { queueEnabled: false });
      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow();

      expect(msg.getStatus()).toBe(Status.ERROR);
    });

    it('should set SENT status on success regardless of queue setting', async () => {
      const dispatcher = createDispatcherWithChannel({}, { queueEnabled: true });
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
    });

    it('should set processing error message on failure', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP 550 rejected'));
      const dispatcher = createDispatcherWithChannel({}, { queueEnabled: true });
      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow();

      expect(msg.getProcessingError()).toContain('SMTP 550 rejected');
    });
  });

  // --------------------------------------------------------------------------
  // CPC-SMTP-003: Per-message transporter (not persistent)
  // --------------------------------------------------------------------------

  describe('CPC-SMTP-003: Per-message connection', () => {
    it('should create a new transporter for each send() call', async () => {
      const dispatcher = createDispatcherWithChannel();
      const msg1 = createMockConnectorMessage();
      const msg2 = createMockConnectorMessage();

      await dispatcher.send(msg1);
      await dispatcher.send(msg2);

      // nodemailer.createTransport should be called once per send
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    });

    it('should close transporter after each send', async () => {
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should close transporter even on send failure', async () => {
      mockSendMail.mockRejectedValue(new Error('send failed'));
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow();

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('should use resolved properties for transporter (not base properties)', async () => {
      const dispatcher = createDispatcherWithChannel({
        smtpHost: '${smtpServer}',
        smtpPort: '${smtpPort}',
        authentication: true,
        username: '${smtpUser}',
        password: '${smtpPass}',
      });
      const msg = createMockConnectorMessage({
        channelMap: {
          smtpServer: 'resolved.smtp.com',
          smtpPort: '465',
          smtpUser: 'resolved-user',
          smtpPass: 'resolved-pass',
        },
      });

      await dispatcher.send(msg);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'resolved.smtp.com',
          port: 465,
          auth: { user: 'resolved-user', pass: 'resolved-pass' },
        })
      );
    });

    it('should not create persistent transporter on start()', async () => {
      const dispatcher = createDispatcherWithChannel();
      await dispatcher.start();

      // No transporter created at start - only per message
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // CPC-SMTP-004: MessageMaps lookup order
  // --------------------------------------------------------------------------

  describe('CPC-SMTP-004: MessageMaps lookup order', () => {
    it('should resolve variables in Java order: responseMap > connectorMap > channelMap > sourceMap', async () => {
      const dispatcher = createDispatcherWithChannel({
        subject: '${testVar}',
      });

      // Put value in sourceMap only — should find it
      const msg1 = createMockConnectorMessage({
        sourceMap: { testVar: 'from-source' },
      });
      await dispatcher.send(msg1);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'from-source' })
      );

      mockSendMail.mockClear();

      // Put in channelMap + sourceMap — channelMap wins
      const msg2 = createMockConnectorMessage({
        channelMap: { testVar: 'from-channel' },
        sourceMap: { testVar: 'from-source' },
      });
      await dispatcher.send(msg2);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'from-channel' })
      );

      mockSendMail.mockClear();

      // Put in connectorMap + channelMap — connectorMap wins
      const msg3 = createMockConnectorMessage({
        connectorMap: { testVar: 'from-connector' },
        channelMap: { testVar: 'from-channel' },
      });
      await dispatcher.send(msg3);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'from-connector' })
      );

      mockSendMail.mockClear();

      // Put in responseMap + connectorMap — responseMap wins (highest priority)
      const msg4 = createMockConnectorMessage({
        responseMap: { testVar: 'from-response' },
        connectorMap: { testVar: 'from-connector' },
      });
      await dispatcher.send(msg4);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'from-response' })
      );
    });

    it('should use getFromMessageMaps for headers variable lookup', async () => {
      const headersMap = new Map<string, string>();
      headersMap.set('X-Custom', 'from-response');

      const dispatcher = createDispatcherWithChannel({
        useHeadersVariable: true,
        headersVariable: 'customHeaders',
      });

      // Put headers in responseMap — should find them (Java: getMessageMaps().get())
      const msg = createMockConnectorMessage({
        responseMap: { customHeaders: headersMap },
      });

      await dispatcher.send(msg);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'X-Custom': 'from-response' },
        })
      );
    });

    it('should use getFromMessageMaps for attachments variable lookup', async () => {
      const attachmentsList = [
        { name: 'test.txt', content: 'hello', mimeType: 'text/plain' },
      ];

      const dispatcher = createDispatcherWithChannel({
        useAttachmentsVariable: true,
        attachmentsVariable: 'myAttachments',
      });

      // Put attachments in sourceMap — should find them via getFromMessageMaps
      const msg = createMockConnectorMessage({
        sourceMap: { myAttachments: attachmentsList },
      });

      await dispatcher.send(msg);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              filename: 'test.txt',
              content: 'hello',
              contentType: 'text/plain',
            }),
          ],
        })
      );
    });

    it('should find headers variable in connectorMap (was previously unchecked)', async () => {
      const headers = { 'X-From-Connector': 'yes' };

      const dispatcher = createDispatcherWithChannel({
        useHeadersVariable: true,
        headersVariable: 'hdrs',
      });

      // connectorMap was NOT checked in the old code (only channelMap was checked first)
      // Now getFromMessageMaps checks responseMap → connectorMap → channelMap → sourceMap
      const msg = createMockConnectorMessage({
        connectorMap: { hdrs: headers },
      });

      await dispatcher.send(msg);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'X-From-Connector': 'yes' },
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // CPC-SMTP-005: reAttachMessage for body content
  // --------------------------------------------------------------------------

  describe('CPC-SMTP-005: reAttachContent for body', () => {
    it('should pass body through reAttachContent before setting on email', async () => {
      const dispatcher = createDispatcherWithChannel({
        body: 'Hello World with attachment ref',
        html: false,
      });
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      // Body should be set (reAttachContent currently passes through)
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello World with attachment ref',
        })
      );
    });

    it('should pass HTML body through reAttachContent', async () => {
      const dispatcher = createDispatcherWithChannel({
        body: '<html><body>Email body</body></html>',
        html: true,
      });
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<html><body>Email body</body></html>',
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // Integration: Full send lifecycle matches Java behavior
  // --------------------------------------------------------------------------

  describe('Full send lifecycle (integration)', () => {
    it('should match Java event sequence: WRITING → send → IDLE', async () => {
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      expect(dispatchedEvents.map((e) => e.state)).toEqual([
        ConnectionStatusEventType.WRITING,
        ConnectionStatusEventType.IDLE,
      ]);
    });

    it('should match Java error sequence: WRITING → IDLE (ErrorEvent via alert pipeline)', async () => {
      mockSendMail.mockRejectedValue(new Error('fail'));
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await expect(dispatcher.send(msg)).rejects.toThrow();

      // CPC-W19-005: ConnectionStatusEvent sequence on error is WRITING → IDLE
      // ErrorEvent is dispatched separately via the alert event controller
      expect(dispatchedEvents.map((e) => e.state)).toEqual([
        ConnectionStatusEventType.WRITING,
        ConnectionStatusEventType.IDLE,
      ]);

      // ErrorEvent dispatched via alert controller (separate from dashboard events)
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.eventType).toBe(ErrorEventType.DESTINATION_CONNECTOR);
    });

    it('should set SENT status and response on success', async () => {
      const dispatcher = createDispatcherWithChannel();
      const msg = createMockConnectorMessage();

      await dispatcher.send(msg);

      expect(msg.getStatus()).toBe(Status.SENT);
      expect(msg.getConnectorMap().get('messageId')).toBe('<test-msg-id@example.com>');
    });
  });
});

// --------------------------------------------------------------------------
// Helper: Create SmtpDispatcher with a mock channel attached
// --------------------------------------------------------------------------

function createDispatcherWithChannel(
  props?: Record<string, unknown>,
  config?: { queueEnabled?: boolean }
): SmtpDispatcher {
  const dispatcher = new SmtpDispatcher({
    metaDataId: 1,
    queueEnabled: config?.queueEnabled ?? false,
    properties: {
      smtpHost: props?.smtpHost as string ?? 'smtp.example.com',
      smtpPort: props?.smtpPort as string ?? '25',
      from: props?.from as string ?? 'sender@example.com',
      to: props?.to as string ?? 'recipient@example.com',
      subject: props?.subject as string ?? 'Test',
      body: props?.body as string ?? 'Test body',
      html: props?.html as boolean ?? false,
      encryption: props?.encryption as 'none' | 'tls' | 'ssl' ?? 'none',
      authentication: props?.authentication as boolean ?? false,
      username: props?.username as string ?? '',
      password: props?.password as string ?? '',
      useHeadersVariable: props?.useHeadersVariable as boolean ?? false,
      headersVariable: props?.headersVariable as string ?? '',
      useAttachmentsVariable: props?.useAttachmentsVariable as boolean ?? false,
      attachmentsVariable: props?.attachmentsVariable as string ?? '',
    },
  });

  // Attach a mock channel so dispatchConnectionEvent works
  const mockChannel = {
    getId: () => 'test-channel-id',
    getName: () => 'Test Channel',
    emit: jest.fn(),
  };
  dispatcher.setChannel(mockChannel as any);

  return dispatcher;
}
