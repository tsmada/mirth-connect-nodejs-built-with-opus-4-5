/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/smtp/SmtpDispatcherProperties.java
 *
 * Purpose: Configuration properties for SMTP email dispatcher
 *
 * Key behaviors to replicate:
 * - SMTP host, port, and timeout configuration
 * - Encryption options (NONE, TLS, SSL)
 * - Authentication (username/password)
 * - Email addressing (from, to, cc, bcc, replyTo)
 * - Subject and body with template support
 * - Headers and attachments configuration
 * - HTML vs plain text body
 */

/**
 * Encryption modes for SMTP connection
 */
export type SmtpEncryption = 'none' | 'tls' | 'ssl';

/**
 * Email attachment configuration
 */
export interface SmtpAttachment {
  /** Attachment filename */
  name: string;
  /** Attachment content (string or base64 for binary) */
  content: string;
  /** MIME type (e.g., "text/plain", "application/pdf") */
  mimeType: string;
}

/**
 * SMTP Dispatcher Properties
 * Matches the Java SmtpDispatcherProperties class structure
 */
export interface SmtpDispatcherProperties {
  /** SMTP server hostname */
  smtpHost: string;

  /** SMTP server port (default: 25 for plain, 465 for SSL, 587 for TLS) */
  smtpPort: string;

  /** Whether to override local binding */
  overrideLocalBinding: boolean;

  /** Local address to bind to */
  localAddress: string;

  /** Local port to bind to */
  localPort: string;

  /** Connection timeout in milliseconds */
  timeout: string;

  /** Encryption mode: none, tls, or ssl */
  encryption: SmtpEncryption;

  /** Whether authentication is required */
  authentication: boolean;

  /** SMTP username */
  username: string;

  /** SMTP password */
  password: string;

  /** Email recipient(s), comma-separated */
  to: string;

  /** Email sender */
  from: string;

  /** CC recipient(s), comma-separated */
  cc: string;

  /** BCC recipient(s), comma-separated */
  bcc: string;

  /** Reply-To address(es), comma-separated */
  replyTo: string;

  /** Custom headers map */
  headers: Map<string, string>;

  /** Variable name for headers if using variable mode */
  headersVariable: string;

  /** Whether to use headers from variable instead of static map */
  useHeadersVariable: boolean;

  /** Email subject (supports ${variable} substitution) */
  subject: string;

  /** Character encoding for email content */
  charsetEncoding: string;

  /** Whether body is HTML content */
  html: boolean;

  /** Email body content (supports ${variable} substitution) */
  body: string;

  /** Static attachments list */
  attachments: SmtpAttachment[];

  /** Variable name for attachments if using variable mode */
  attachmentsVariable: string;

  /** Whether to use attachments from variable instead of static list */
  useAttachmentsVariable: boolean;

  /** Data type for content */
  dataType: string;
}

/**
 * Get default SMTP dispatcher properties matching Java defaults
 */
export function getDefaultSmtpDispatcherProperties(): SmtpDispatcherProperties {
  return {
    smtpHost: '',
    smtpPort: '25',
    overrideLocalBinding: false,
    localAddress: '0.0.0.0',
    localPort: '0',
    timeout: '5000',
    encryption: 'none',
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
}

/**
 * Clone an attachment object
 */
export function cloneAttachment(attachment: SmtpAttachment): SmtpAttachment {
  return {
    name: attachment.name,
    content: attachment.content,
    mimeType: attachment.mimeType,
  };
}

/**
 * Clone SMTP dispatcher properties
 */
export function cloneSmtpDispatcherProperties(
  props: SmtpDispatcherProperties
): SmtpDispatcherProperties {
  return {
    ...props,
    headers: new Map(props.headers),
    attachments: props.attachments.map(cloneAttachment),
  };
}

/**
 * Format SMTP properties to a human-readable string
 * Matches Java toFormattedString() method
 */
export function formatSmtpProperties(props: SmtpDispatcherProperties): string {
  const lines: string[] = [];

  lines.push(`HOST: ${props.smtpHost}:${props.smtpPort}`);

  if (props.username) {
    lines.push(`USERNAME: ${props.username}`);
  }

  lines.push(`TO: ${props.to}`);
  lines.push(`FROM: ${props.from}`);
  lines.push(`CC: ${props.cc}`);
  lines.push(`SUBJECT: ${props.subject}`);

  lines.push('');
  lines.push('[HEADERS]');
  if (props.useHeadersVariable) {
    lines.push(`Using variable '${props.headersVariable}'`);
  } else {
    for (const [key, value] of props.headers) {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push('');
  lines.push('[ATTACHMENTS]');
  if (props.useAttachmentsVariable) {
    lines.push(`Using variable '${props.attachmentsVariable}'`);
  } else {
    for (const attachment of props.attachments) {
      lines.push(`${attachment.name} (${attachment.mimeType})`);
    }
  }

  lines.push('');
  lines.push('[CONTENT]');
  lines.push(props.body);

  return lines.join('\n');
}

/**
 * Parse comma-separated email addresses
 * Handles whitespace around commas
 */
export function parseEmailAddresses(addresses: string): string[] {
  if (!addresses || !addresses.trim()) {
    return [];
  }

  return addresses
    .split(',')
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);
}

/**
 * Determine if MIME type indicates text content
 */
export function isTextMimeType(mimeType: string): boolean {
  if (!mimeType) {
    return true;
  }

  const lowerType = mimeType.toLowerCase();
  return lowerType.startsWith('text/') || lowerType === 'application/xml';
}

/**
 * Validate MIME type has proper format (contains /)
 */
export function isValidMimeType(mimeType: string): boolean {
  return mimeType.indexOf('/') >= 0;
}
