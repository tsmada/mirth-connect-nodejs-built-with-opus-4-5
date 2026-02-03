/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/AlertSender.java
 *
 * Purpose: Allows users to dispatch error events which can be alerted on.
 *
 * Key behaviors to replicate:
 * - Create AlertSender with channel ID or connector message
 * - Dispatch user-defined error events
 * - Events can be caught by alert system for notifications
 */

/**
 * Error event types matching Java implementation
 */
export enum ErrorEventType {
  /** User-defined error in transformer/filter/preprocessor */
  USER_DEFINED_TRANSFORMER = 'USER_DEFINED_TRANSFORMER',

  /** Error in source connector */
  SOURCE_CONNECTOR = 'SOURCE_CONNECTOR',

  /** Error in destination connector */
  DESTINATION_CONNECTOR = 'DESTINATION_CONNECTOR',

  /** Error in filter */
  FILTER = 'FILTER',

  /** Error in transformer */
  TRANSFORMER = 'TRANSFORMER',

  /** Error in serializer */
  SERIALIZER = 'SERIALIZER',

  /** Error in response transformer */
  RESPONSE_TRANSFORMER = 'RESPONSE_TRANSFORMER',

  /** General error */
  GENERAL = 'GENERAL',
}

/**
 * Error event that can be dispatched and alerted on
 */
export interface ErrorEvent {
  channelId: string;
  metaDataId?: number;
  messageId?: number;
  eventType: ErrorEventType;
  connectorName?: string;
  errorCode?: string;
  errorMessage: string;
  throwable?: Error;
  timestamp: Date;
}

/**
 * Interface for connector message that provides context for alerts
 */
export interface IAlertConnectorMessage {
  getChannelId(): string;
  getMetaDataId(): number;
  getConnectorName(): string;
}

/**
 * Interface for event controller used by AlertSender
 */
export interface IEventController {
  dispatchEvent(event: ErrorEvent): void;
}

// Singleton event controller
let eventController: IEventController | null = null;

/**
 * Set the event controller for AlertSender to use.
 * This should be called during application startup.
 */
export function setAlertEventController(controller: IEventController): void {
  eventController = controller;
}

/**
 * Get the current event controller.
 */
export function getAlertEventController(): IEventController | null {
  return eventController;
}

/**
 * Default event controller that logs to console
 */
const defaultEventController: IEventController = {
  dispatchEvent(event: ErrorEvent): void {
    console.warn(`[AlertSender] Error event dispatched:`, {
      channelId: event.channelId,
      metaDataId: event.metaDataId,
      eventType: event.eventType,
      connectorName: event.connectorName,
      errorMessage: event.errorMessage,
      timestamp: event.timestamp.toISOString(),
    });
  },
};

/**
 * Allows users to dispatch error events which can be alerted on.
 */
export class AlertSender {
  private eventCtrl: IEventController;
  private channelId: string;
  private metaDataId?: number;
  private connectorName?: string;

  /**
   * Instantiates a new AlertSender.
   *
   * @param channelId The ID of the channel to associate dispatched alert events with.
   */
  constructor(channelId: string);

  /**
   * Instantiates a new AlertSender.
   *
   * @param connectorMessage The connector message to associate dispatched alert events with.
   */
  constructor(connectorMessage: IAlertConnectorMessage);

  /**
   * Instantiates a new AlertSender with a custom event controller.
   *
   * @param channelIdOrMessage The channel ID or connector message.
   * @param customEventController Optional custom event controller.
   */
  constructor(
    channelIdOrMessage: string | IAlertConnectorMessage,
    customEventController?: IEventController
  );

  // Implementation
  constructor(
    channelIdOrMessage: string | IAlertConnectorMessage,
    customEventController?: IEventController
  ) {
    // Set up event controller
    if (customEventController) {
      this.eventCtrl = customEventController;
    } else if (eventController) {
      this.eventCtrl = eventController;
    } else {
      this.eventCtrl = defaultEventController;
    }

    // Extract channel info from parameter
    if (typeof channelIdOrMessage === 'string') {
      this.channelId = channelIdOrMessage;
    } else {
      this.channelId = channelIdOrMessage.getChannelId();
      this.metaDataId = channelIdOrMessage.getMetaDataId();
      this.connectorName = channelIdOrMessage.getConnectorName();
    }
  }

  /**
   * Dispatches an error event that can be alerted on.
   *
   * @param errorMessage A custom error message to include with the error event.
   */
  sendAlert(errorMessage: string): void {
    const event: ErrorEvent = {
      channelId: this.channelId,
      metaDataId: this.metaDataId,
      messageId: undefined,
      eventType: ErrorEventType.USER_DEFINED_TRANSFORMER,
      connectorName: this.connectorName,
      errorCode: undefined,
      errorMessage: errorMessage,
      throwable: undefined,
      timestamp: new Date(),
    };

    this.eventCtrl.dispatchEvent(event);
  }

  /**
   * Get the channel ID associated with this AlertSender.
   */
  getChannelId(): string {
    return this.channelId;
  }

  /**
   * Get the metadata ID associated with this AlertSender (if any).
   */
  getMetaDataId(): number | undefined {
    return this.metaDataId;
  }

  /**
   * Get the connector name associated with this AlertSender (if any).
   */
  getConnectorName(): string | undefined {
    return this.connectorName;
  }
}
