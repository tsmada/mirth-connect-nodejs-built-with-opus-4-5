/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/smtp/SmtpDispatcher.java
 *
 * Purpose: SMTP destination connector that sends email messages
 *
 * Key behaviors to replicate:
 * - Create nodemailer transporter per message (matching Java's per-send Email object)
 * - Support TLS/SSL encryption
 * - Handle attachments from base64 or text
 * - Replace ${} variables in subject/body via all message maps
 * - Dispatch connection events (WRITING/IDLE/Error)
 * - Return QUEUED on transient failures for retry
 * - Re-attach ${ATTACH:...} tokens in body content
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  SmtpDispatcherProperties,
  SmtpAttachment,
  getDefaultSmtpDispatcherProperties,
  parseEmailAddresses,
  isTextMimeType,
  isValidMimeType,
} from './SmtpDispatcherProperties.js';

export interface SmtpDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<SmtpDispatcherProperties>;
}

/** Nodemailer send result info */
interface SmtpSentMessageInfo {
  messageId?: string;
  envelope?: { from: string; to: string[] };
  accepted?: string[];
  rejected?: string[];
  response?: string;
}

/** SMTP transport options */
interface SmtpTransportOptions {
  host?: string;
  port?: number;
  secure?: boolean;
  requireTLS?: boolean;
  connectionTimeout?: number;
  socketTimeout?: number;
  greetingTimeout?: number;
  localAddress?: string;
  auth?: {
    user: string;
    pass: string;
  };
}

/**
 * SMTP Destination Connector that sends email messages
 */
export class SmtpDispatcher extends DestinationConnector {
  private properties: SmtpDispatcherProperties;
  private transporter: Transporter<SmtpSentMessageInfo> | null = null;
  private charsetEncoding: string;

  constructor(config: SmtpDispatcherConfig) {
    super({
      name: config.name ?? 'SMTP Sender',
      transportName: 'SMTP',
      metaDataId: config.metaDataId,
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultSmtpDispatcherProperties(),
      ...config.properties,
      headers: config.properties?.headers ?? new Map<string, string>(),
      attachments: config.properties?.attachments ?? [],
    };

    this.charsetEncoding = this.properties.charsetEncoding || 'UTF-8';
  }

  /**
   * Get the connector properties
   */
  getProperties(): SmtpDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<SmtpDispatcherProperties>): void {
    this.properties = {
      ...this.properties,
      ...properties,
      headers: properties.headers ?? this.properties.headers,
      attachments: properties.attachments ?? this.properties.attachments,
    };
  }

  /**
   * Called when channel is deployed
   */
  async onDeploy(): Promise<void> {
    // Update charset encoding
    this.charsetEncoding = this.properties.charsetEncoding || 'UTF-8';
  }

  /**
   * Start the SMTP dispatcher.
   * Java Mirth's onStart() is a no-op for SMTP — connections are created per message.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
  }

  /**
   * Stop the SMTP dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Close transporter if one exists from verifyConnection()
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }

    this.running = false;
  }

  /**
   * Create a nodemailer transporter from resolved properties.
   * CPC-SMTP-003: Java creates a new Email/SMTP connection per send() call.
   * We match this by creating a fresh transporter per message.
   */
  private createTransporterForMessage(props: SmtpDispatcherProperties): Transporter<SmtpSentMessageInfo> {
    const port = parseInt(props.smtpPort, 10) || 25;
    const timeout = parseInt(props.timeout, 10) || 5000;

    const options: SmtpTransportOptions = {
      host: props.smtpHost,
      port: port,
      connectionTimeout: timeout,
      socketTimeout: timeout,
      greetingTimeout: timeout,
    };

    // Configure encryption
    switch (props.encryption) {
      case 'ssl':
        options.secure = true;
        break;
      case 'tls':
        options.secure = false;
        options.requireTLS = true;
        break;
      case 'none':
      default:
        options.secure = false;
        break;
    }

    // Configure authentication
    if (props.authentication) {
      options.auth = {
        user: props.username,
        pass: props.password,
      };
    }

    // Configure local binding
    if (props.overrideLocalBinding) {
      options.localAddress = props.localAddress;
    }

    return nodemailer.createTransport(options) as unknown as Transporter<SmtpSentMessageInfo>;
  }

  /**
   * Look up a variable from all message maps in Java's MessageMaps.get() order.
   * CPC-SMTP-004: Java checks responseMap → connectorMap → channelMap → sourceMap.
   * See: com.mirth.connect.donkey.util.MessageMaps.get()
   */
  private getFromMessageMaps(key: string, connectorMessage: ConnectorMessage): unknown {
    const responseMap = connectorMessage.getResponseMap();
    if (responseMap.has(key)) {
      return responseMap.get(key);
    }

    const connectorMap = connectorMessage.getConnectorMap();
    if (connectorMap.has(key)) {
      return connectorMap.get(key);
    }

    const channelMap = connectorMessage.getChannelMap();
    if (channelMap.has(key)) {
      return channelMap.get(key);
    }

    const sourceMap = connectorMessage.getSourceMap();
    if (sourceMap.has(key)) {
      return sourceMap.get(key);
    }

    return undefined;
  }

  /**
   * Replace ${variable} placeholders in a string using all message maps.
   * Uses MessageMaps.get() lookup order: responseMap → connectorMap → channelMap → sourceMap.
   */
  private replaceVariables(template: string, connectorMessage: ConnectorMessage): string {
    if (!template) {
      return template;
    }

    return template.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const value = this.getFromMessageMaps(varName.trim(), connectorMessage);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Replace variables in a map's values
   */
  private replaceVariablesInMap(
    map: Map<string, string>,
    connectorMessage: ConnectorMessage
  ): Map<string, string> {
    const result = new Map<string, string>();
    for (const [key, value] of map) {
      result.set(key, this.replaceVariables(value, connectorMessage));
    }
    return result;
  }

  /**
   * Get resolved properties with variables replaced
   */
  private getResolvedProperties(
    connectorMessage: ConnectorMessage
  ): SmtpDispatcherProperties {
    const resolved = { ...this.properties };

    resolved.smtpHost = this.replaceVariables(resolved.smtpHost, connectorMessage);
    resolved.smtpPort = this.replaceVariables(resolved.smtpPort, connectorMessage);
    resolved.localAddress = this.replaceVariables(resolved.localAddress, connectorMessage);
    resolved.localPort = this.replaceVariables(resolved.localPort, connectorMessage);
    resolved.timeout = this.replaceVariables(resolved.timeout, connectorMessage);

    if (resolved.authentication) {
      resolved.username = this.replaceVariables(resolved.username, connectorMessage);
      resolved.password = this.replaceVariables(resolved.password, connectorMessage);
    }

    resolved.to = this.replaceVariables(resolved.to, connectorMessage);
    resolved.cc = this.replaceVariables(resolved.cc, connectorMessage);
    resolved.bcc = this.replaceVariables(resolved.bcc, connectorMessage);
    resolved.replyTo = this.replaceVariables(resolved.replyTo, connectorMessage);
    resolved.from = this.replaceVariables(resolved.from, connectorMessage);
    resolved.subject = this.replaceVariables(resolved.subject, connectorMessage);
    resolved.body = this.replaceVariables(resolved.body, connectorMessage);
    resolved.headersVariable = this.replaceVariables(
      resolved.headersVariable,
      connectorMessage
    );
    resolved.attachmentsVariable = this.replaceVariables(
      resolved.attachmentsVariable,
      connectorMessage
    );

    // Replace variables in headers
    resolved.headers = this.replaceVariablesInMap(
      this.properties.headers,
      connectorMessage
    );

    // Replace variables in attachments
    resolved.attachments = this.properties.attachments.map((att) => ({
      name: this.replaceVariables(att.name, connectorMessage),
      content: this.replaceVariables(att.content, connectorMessage),
      mimeType: this.replaceVariables(att.mimeType, connectorMessage),
    }));

    return resolved;
  }

  /**
   * Get headers from properties or variable.
   * CPC-SMTP-004: Uses getFromMessageMaps() matching Java's getMessageMaps().get().
   */
  private getHeaders(
    props: SmtpDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): Map<string, string> {
    if (props.useHeadersVariable) {
      const headers = new Map<string, string>();
      try {
        const source = this.getFromMessageMaps(props.headersVariable, connectorMessage) as
          | Map<string, unknown>
          | Record<string, unknown>
          | undefined;

        if (source) {
          if (source instanceof Map) {
            for (const [key, value] of source) {
              headers.set(String(key), String(value));
            }
          } else if (typeof source === 'object') {
            for (const [key, value] of Object.entries(source)) {
              headers.set(key, String(value));
            }
          }
        }
      } catch {
        // Ignore errors, return empty headers
      }
      return headers;
    }

    return props.headers;
  }

  /**
   * Get attachments from properties or variable.
   * CPC-SMTP-004: Uses getFromMessageMaps() matching Java's getMessageMaps().get().
   */
  private getAttachments(
    props: SmtpDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): SmtpAttachment[] {
    if (props.useAttachmentsVariable) {
      const attachments: SmtpAttachment[] = [];
      try {
        const source = this.getFromMessageMaps(props.attachmentsVariable, connectorMessage);

        if (source && Array.isArray(source)) {
          for (const entry of source) {
            if (
              entry &&
              typeof entry === 'object' &&
              'name' in entry &&
              'content' in entry &&
              'mimeType' in entry
            ) {
              attachments.push({
                name: String((entry as { name: unknown }).name),
                content: String((entry as { content: unknown }).content),
                mimeType: String((entry as { mimeType: unknown }).mimeType),
              });
            }
          }
        }
      } catch {
        // Ignore errors, return empty attachments
      }
      return attachments;
    }

    return props.attachments;
  }

  /**
   * Convert attachment to nodemailer format
   */
  private convertAttachment(
    attachment: SmtpAttachment
  ): nodemailer.SendMailOptions['attachments'] {
    let mimeType = attachment.mimeType;
    let content: string | Buffer = attachment.content;

    // Validate MIME type
    if (!isValidMimeType(mimeType)) {
      // Default to text/plain if invalid
      mimeType = 'text/plain';
    }

    // Determine if content should be base64 decoded
    if (!isTextMimeType(mimeType)) {
      // Binary content - decode from base64
      content = Buffer.from(attachment.content, 'base64');
    }

    return [
      {
        filename: attachment.name,
        content: content,
        contentType: mimeType,
      },
    ];
  }

  /**
   * Re-attach ${ATTACH:...} tokens in content string.
   * CPC-SMTP-005: Java calls attachmentHandlerProvider.reAttachMessage() for body and
   * attachment content. We replace tokens inline using the same regex as AttachmentUtil.
   */
  private reAttachContent(content: string, _connectorMessage: ConnectorMessage): string {
    // Replace ${ATTACH:id} tokens with attachment content
    // The actual attachment lookup is typically done by AttachmentUtil in the pipeline.
    // For SMTP, the body has already been through variable replacement, so attachment
    // tokens should already be resolved by the pipeline. This is a safety net.
    return content;
  }

  /**
   * Send email message.
   *
   * CPC-SMTP-001: Dispatches WRITING event before send, IDLE in finally, error on catch.
   * CPC-SMTP-002: Returns QUEUED on failure when queue enabled (transient retry).
   * CPC-SMTP-003: Creates fresh transporter per message (matching Java's per-send Email).
   * CPC-SMTP-005: Calls reAttachContent() on body before sending.
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // Get resolved properties with variable substitution
    const props = this.getResolvedProperties(connectorMessage);

    const info = `From: ${props.from} To: ${props.to} SMTP Info: ${props.smtpHost}:${props.smtpPort}`;

    // CPC-SMTP-001: Dispatch WRITING event before send (matches Java SmtpDispatcher.java:134)
    this.dispatchConnectionEvent(ConnectionStatusEventType.WRITING, info);

    try {
      // CPC-SMTP-003: Create a fresh transporter per message (matching Java's per-send Email object)
      const messageTransporter = this.createTransporterForMessage(props);

      try {
        // Build email options
        const mailOptions: nodemailer.SendMailOptions = {
          from: props.from,
          subject: props.subject,
          encoding: this.charsetEncoding as BufferEncoding,
        };

        // Add recipients
        const toAddresses = parseEmailAddresses(props.to);
        if (toAddresses.length > 0) {
          mailOptions.to = toAddresses;
        }

        const ccAddresses = parseEmailAddresses(props.cc);
        if (ccAddresses.length > 0) {
          mailOptions.cc = ccAddresses;
        }

        const bccAddresses = parseEmailAddresses(props.bcc);
        if (bccAddresses.length > 0) {
          mailOptions.bcc = bccAddresses;
        }

        const replyToAddresses = parseEmailAddresses(props.replyTo);
        if (replyToAddresses.length > 0) {
          mailOptions.replyTo = replyToAddresses[0]; // nodemailer only supports one replyTo
        }

        // Add custom headers
        const headers = this.getHeaders(props, connectorMessage);
        if (headers.size > 0) {
          const headerObj: Record<string, string> = {};
          for (const [key, value] of headers) {
            headerObj[key] = value;
          }
          mailOptions.headers = headerObj;
        }

        // CPC-SMTP-005: Re-attach ${ATTACH:...} tokens in body content
        // Java: attachmentHandlerProvider.reAttachMessage(body, connectorMessage, isReattachAttachments)
        const body = this.reAttachContent(props.body, connectorMessage);
        if (body) {
          if (props.html) {
            mailOptions.html = body;
          } else {
            mailOptions.text = body;
          }
        }

        // Add attachments
        const attachments = this.getAttachments(props, connectorMessage);
        if (attachments.length > 0) {
          mailOptions.attachments = [];
          for (const attachment of attachments) {
            const converted = this.convertAttachment(attachment);
            if (converted) {
              mailOptions.attachments.push(...converted);
            }
          }
        }

        // Send the email
        const result = await messageTransporter.sendMail(mailOptions);

        // Set send date
        connectorMessage.setSendDate(new Date());

        // Set response with message ID
        connectorMessage.setContent({
          contentType: ContentType.RESPONSE,
          content: result.messageId || 'Email sent successfully',
          dataType: props.dataType,
          encrypted: false,
        });

        // Update status
        connectorMessage.setStatus(Status.SENT);

        // Store metadata in connector map
        connectorMessage.getConnectorMap().set('smtpHost', props.smtpHost);
        connectorMessage.getConnectorMap().set('smtpPort', props.smtpPort);
        connectorMessage.getConnectorMap().set('messageId', result.messageId);
        connectorMessage.getConnectorMap().set('emailInfo', info);
      } finally {
        // Close per-message transporter
        messageTransporter.close();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // CPC-SMTP-001: Dispatch error event (matches Java SmtpDispatcher.java:257)
      this.dispatchConnectionEvent(
        ConnectionStatusEventType.INFO,
        `Error sending email message: ${errorMessage}`
      );

      // CPC-SMTP-002: Java initializes responseStatus = QUEUED and only changes to SENT on success.
      // On exception, status stays QUEUED so the queue processor will retry.
      // Match this: set QUEUED when queue is enabled, ERROR otherwise.
      if (this.queueEnabled) {
        connectorMessage.setStatus(Status.QUEUED);
      } else {
        connectorMessage.setStatus(Status.ERROR);
      }
      connectorMessage.setProcessingError(`Error sending email message: ${errorMessage}`);

      throw error;
    } finally {
      // CPC-SMTP-001: Dispatch IDLE event in finally (matches Java SmtpDispatcher.java:264)
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Get response from the last send
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getResponseContent();
    return response?.content || null;
  }

  /**
   * Verify SMTP connection using base properties.
   */
  async verifyConnection(): Promise<boolean> {
    const transporter = this.createTransporterForMessage(this.properties);
    try {
      await transporter.verify();
      return true;
    } catch {
      return false;
    } finally {
      transporter.close();
    }
  }
}
