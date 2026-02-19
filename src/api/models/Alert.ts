/**
 * Alert Models
 *
 * Ported from:
 * - ~/Projects/connect/server/src/com/mirth/connect/model/alert/AlertModel.java
 * - ~/Projects/connect/server/src/com/mirth/connect/model/alert/AlertStatus.java
 * - ~/Projects/connect/server/src/com/mirth/connect/model/alert/AlertInfo.java
 *
 * Alerts are triggered by events (errors, specific messages, etc.) and
 * execute actions (send email, webhook, etc.).
 */

// ============================================================================
// Alert Action Types
// ============================================================================

/**
 * An action to execute when an alert triggers
 */
export interface AlertAction {
  /** Protocol name (e.g., "Email", "Webhook") */
  protocol: string;
  /** Recipient (email address, webhook URL, etc.) */
  recipient: string;
}

/**
 * A group of actions with shared subject/template
 */
export interface AlertActionGroup {
  /** List of actions to execute */
  actions: AlertAction[];
  /** Subject line (for email) */
  subject?: string;
  /** Message template/body */
  template?: string;
}

// ============================================================================
// Alert Trigger Types
// ============================================================================

/**
 * Base alert trigger interface
 */
export interface AlertTrigger {
  /** Trigger type name */
  name: string;
  /** Trigger-specific configuration */
  [key: string]: unknown;
}

/**
 * Error-based trigger
 */
export interface ErrorAlertTrigger extends AlertTrigger {
  name: 'ErrorAlertTrigger';
  /** Error codes to match */
  errorCodes?: string[];
  /** Regex pattern for error messages */
  regex?: string;
}

/**
 * Channel-based trigger for specific connectors
 */
export interface AlertConnectors {
  /** Enabled connector metadata IDs */
  enabledConnectors: Set<number>;
  /** Disabled connector metadata IDs */
  disabledConnectors: Set<number>;
}

/**
 * Channel configuration for alerts
 */
export interface AlertChannels {
  /** Alert on new channel sources */
  newChannelSource: boolean;
  /** Alert on new channel destinations */
  newChannelDestination: boolean;
  /** Channels with all connectors enabled */
  enabledChannels: Set<string>;
  /** Channels with all connectors disabled */
  disabledChannels: Set<string>;
  /** Channels with mixed connector states */
  partialChannels: Map<string, AlertConnectors>;
}

// ============================================================================
// Alert Model
// ============================================================================

/**
 * Complete alert model
 */
export interface AlertModel {
  /** UUID identifier */
  id: string;
  /** Alert name */
  name: string;
  /** Enable/disable flag */
  enabled: boolean;
  /** Alert trigger configuration */
  trigger: AlertTrigger;
  /** Action groups to execute */
  actionGroups: AlertActionGroup[];
  /** Generic properties map */
  properties?: Record<string, unknown>;
  /** Channel configuration */
  alertChannels?: AlertChannels;
}

/**
 * Create a new alert with defaults
 */
export function createAlert(
  id: string,
  name: string,
  trigger: AlertTrigger,
  actionGroup?: AlertActionGroup
): AlertModel {
  return {
    id,
    name,
    enabled: false,
    trigger,
    actionGroups: actionGroup ? [actionGroup] : [],
  };
}

// ============================================================================
// Alert Status (Dashboard)
// ============================================================================

/**
 * Alert status for dashboard display
 */
export interface AlertStatus {
  /** Alert ID */
  id: string;
  /** Alert name */
  name: string;
  /** Enable/disable flag */
  enabled: boolean;
  /** Count of times alert has fired */
  alertedCount: number;
}

/**
 * Convert AlertModel to AlertStatus
 */
export function toAlertStatus(alert: AlertModel, alertedCount: number = 0): AlertStatus {
  return {
    id: alert.id,
    name: alert.name,
    enabled: alert.enabled,
    alertedCount,
  };
}

// ============================================================================
// Alert Info (Composite Response)
// ============================================================================

/**
 * Channel summary for changed channels
 */
export interface ChannelSummary {
  channelId: string;
  name: string;
}

/**
 * Composite alert information response
 */
export interface AlertInfo {
  /** The alert model (optional if getting info without specific alert) */
  model?: AlertModel;
  /** Alert protocol options (protocol name -> options map) */
  protocolOptions: Record<string, Record<string, string>>;
  /** Updated channel summaries */
  changedChannels: ChannelSummary[];
}

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Convert AlertChannels to plain object for serialization
 */
export function alertChannelsToObject(channels: AlertChannels): Record<string, unknown> {
  return {
    newChannelSource: channels.newChannelSource,
    newChannelDestination: channels.newChannelDestination,
    enabledChannels: Array.from(channels.enabledChannels),
    disabledChannels: Array.from(channels.disabledChannels),
    partialChannels: Object.fromEntries(
      Array.from(channels.partialChannels.entries()).map(([channelId, connectors]) => [
        channelId,
        {
          enabledConnectors: Array.from(connectors.enabledConnectors),
          disabledConnectors: Array.from(connectors.disabledConnectors),
        },
      ])
    ),
  };
}

/**
 * Convert plain object to AlertChannels
 */
export function objectToAlertChannels(obj: Record<string, unknown>): AlertChannels {
  const enabledChannels = new Set<string>(
    Array.isArray(obj.enabledChannels) ? obj.enabledChannels : []
  );
  const disabledChannels = new Set<string>(
    Array.isArray(obj.disabledChannels) ? obj.disabledChannels : []
  );

  const partialChannels = new Map<string, AlertConnectors>();
  if (obj.partialChannels && typeof obj.partialChannels === 'object') {
    for (const [channelId, connectors] of Object.entries(
      obj.partialChannels as Record<
        string,
        { enabledConnectors?: number[]; disabledConnectors?: number[] }
      >
    )) {
      partialChannels.set(channelId, {
        enabledConnectors: new Set(connectors.enabledConnectors ?? []),
        disabledConnectors: new Set(connectors.disabledConnectors ?? []),
      });
    }
  }

  return {
    newChannelSource: Boolean(obj.newChannelSource),
    newChannelDestination: Boolean(obj.newChannelDestination),
    enabledChannels,
    disabledChannels,
    partialChannels,
  };
}

/**
 * Serialize AlertModel for database storage
 */
export function serializeAlertModel(alert: AlertModel): string {
  // Convert Sets to arrays for JSON serialization
  const serializable = {
    ...alert,
    alertChannels: alert.alertChannels ? alertChannelsToObject(alert.alertChannels) : undefined,
  };
  return JSON.stringify(serializable);
}

/**
 * Deserialize AlertModel from database
 */
export function deserializeAlertModel(data: string): AlertModel {
  const parsed = JSON.parse(data);

  // Convert arrays back to Sets
  if (parsed.alertChannels) {
    parsed.alertChannels = objectToAlertChannels(parsed.alertChannels);
  }

  return parsed as AlertModel;
}
