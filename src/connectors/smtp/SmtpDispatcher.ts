/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/smtp/SmtpDispatcher.java
 *
 * Purpose: SMTP destination connector that sends email messages
 *
 * Key behaviors to replicate:
 * - Create nodemailer transporter based on properties
 * - Support TLS/SSL encryption
 * - Handle attachments from base64 or text
 * - Replace ${} variables in subject/body
 * - Return proper Response objects with message ID
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
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
   * Start the SMTP dispatcher
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // Create transporter on start
    this.createTransporter();
    this.running = true;
  }

  /**
   * Stop the SMTP dispatcher
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    // Close transporter
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }

    this.running = false;
  }

  /**
   * Create nodemailer transporter based on properties
   */
  private createTransporter(): void {
    const port = parseInt(this.properties.smtpPort, 10) || 25;
    const timeout = parseInt(this.properties.timeout, 10) || 5000;

    const options: SmtpTransportOptions = {
      host: this.properties.smtpHost,
      port: port,
      connectionTimeout: timeout,
      socketTimeout: timeout,
      greetingTimeout: timeout,
    };

    // Configure encryption
    switch (this.properties.encryption) {
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
    if (this.properties.authentication) {
      options.auth = {
        user: this.properties.username,
        pass: this.properties.password,
      };
    }

    // Configure local binding
    if (this.properties.overrideLocalBinding) {
      options.localAddress = this.properties.localAddress;
    }

    this.transporter = nodemailer.createTransport(options) as unknown as Transporter<SmtpSentMessageInfo>;
  }

  /**
   * Replace ${variable} placeholders in a string using connector message maps
   */
  private replaceVariables(template: string, connectorMessage: ConnectorMessage): string {
    if (!template) {
      return template;
    }

    // Replace ${varName} patterns with values from message maps
    return template.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const trimmedName = varName.trim();

      // Check connector map first
      const connectorValue = connectorMessage.getConnectorMap().get(trimmedName);
      if (connectorValue !== undefined) {
        return String(connectorValue);
      }

      // Check channel map
      const channelValue = connectorMessage.getChannelMap().get(trimmedName);
      if (channelValue !== undefined) {
        return String(channelValue);
      }

      // Check source map
      const sourceValue = connectorMessage.getSourceMap().get(trimmedName);
      if (sourceValue !== undefined) {
        return String(sourceValue);
      }

      // Check response map
      const responseValue = connectorMessage.getResponseMap().get(trimmedName);
      if (responseValue !== undefined) {
        return String(responseValue);
      }

      // Return original if not found
      return match;
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
   * Get headers from properties or variable
   */
  private getHeaders(
    props: SmtpDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): Map<string, string> {
    if (props.useHeadersVariable) {
      const headers = new Map<string, string>();
      try {
        // Try to get headers from channel/connector map
        let source: Map<string, unknown> | Record<string, unknown> | undefined;

        const channelValue = connectorMessage.getChannelMap().get(props.headersVariable);
        if (channelValue) {
          source = channelValue as Map<string, unknown> | Record<string, unknown>;
        } else {
          const connectorValue = connectorMessage
            .getConnectorMap()
            .get(props.headersVariable);
          if (connectorValue) {
            source = connectorValue as Map<string, unknown> | Record<string, unknown>;
          }
        }

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
   * Get attachments from properties or variable
   */
  private getAttachments(
    props: SmtpDispatcherProperties,
    connectorMessage: ConnectorMessage
  ): SmtpAttachment[] {
    if (props.useAttachmentsVariable) {
      const attachments: SmtpAttachment[] = [];
      try {
        // Try to get attachments from channel/connector map
        let source: unknown[] | undefined;

        const channelValue = connectorMessage
          .getChannelMap()
          .get(props.attachmentsVariable);
        if (channelValue && Array.isArray(channelValue)) {
          source = channelValue;
        } else {
          const connectorValue = connectorMessage
            .getConnectorMap()
            .get(props.attachmentsVariable);
          if (connectorValue && Array.isArray(connectorValue)) {
            source = connectorValue;
          }
        }

        if (source) {
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
   * Send email message
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // Ensure transporter exists
    if (!this.transporter) {
      this.createTransporter();
    }

    if (!this.transporter) {
      throw new Error('Failed to create SMTP transporter');
    }

    // Get resolved properties with variable substitution
    const props = this.getResolvedProperties(connectorMessage);

    const info = `From: ${props.from} To: ${props.to} SMTP Info: ${props.smtpHost}:${props.smtpPort}`;

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

      // Add body content
      const body = props.body;
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
      const result = await this.transporter.sendMail(mailOptions);

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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError(`Error sending email message: ${errorMessage}`);

      throw error;
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
   * Verify SMTP connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      this.createTransporter();
    }

    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the transporter (for testing)
   */
  getTransporter(): Transporter<SmtpSentMessageInfo> | null {
    return this.transporter;
  }
}
