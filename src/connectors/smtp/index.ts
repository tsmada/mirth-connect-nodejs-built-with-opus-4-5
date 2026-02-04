/**
 * SMTP Connector
 *
 * Email sending connector for Mirth Connect Node.js runtime.
 * Ported from Java implementation.
 */

export {
  SmtpDispatcher,
  type SmtpDispatcherConfig,
} from './SmtpDispatcher.js';

export {
  type SmtpDispatcherProperties,
  type SmtpAttachment,
  type SmtpEncryption,
  getDefaultSmtpDispatcherProperties,
  cloneSmtpDispatcherProperties,
  cloneAttachment,
  formatSmtpProperties,
  parseEmailAddresses,
  isTextMimeType,
  isValidMimeType,
} from './SmtpDispatcherProperties.js';
