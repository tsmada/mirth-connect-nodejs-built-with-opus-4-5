/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/VMRouter.java
 *
 * Purpose: Utility class used to dispatch messages to channels. This is the primary mechanism
 * for inter-channel message routing in Mirth Connect.
 *
 * Key behaviors to replicate:
 * - Route by channel name or channel ID
 * - Accept both string messages and RawMessage objects
 * - Return Response objects indicating success/failure
 * - Handle errors gracefully with ERROR status responses
 */

import { Response } from '../../model/Response.js';
import { Status } from '../../model/Status.js';
import { RawMessage } from './RawMessage.js';

/**
 * Interface for the channel controller that provides channel lookup.
 * This abstracts away the actual controller implementation for better testability.
 */
export interface IChannelController {
  /**
   * Get a deployed channel by name.
   * @returns The channel object with at least an 'id' property, or null if not found.
   */
  getDeployedChannelByName(channelName: string): { id: string } | null;

  /**
   * Get a deployed channel by ID.
   * @returns The channel object, or null if not found.
   */
  getDeployedChannelById?(channelId: string): { id: string; name: string } | null;
}

/**
 * Interface for the engine controller that handles message dispatch.
 */
export interface IEngineController {
  /**
   * Dispatch a raw message to a channel.
   * @param channelId The channel ID to dispatch to.
   * @param rawMessage The raw message data.
   * @param force If true, bypass any throttling or checks.
   * @param storeRawResponse If true, store the raw response data.
   * @returns The dispatch result with the selected response, or null.
   */
  dispatchRawMessage(
    channelId: string,
    rawMessage: {
      rawData: string;
      rawBytes?: Uint8Array | null;
      destinationMetaDataIds?: Set<number> | null;
      sourceMap?: Map<string, unknown>;
    },
    force: boolean,
    storeRawResponse: boolean
  ): Promise<DispatchResult | null>;
}

/**
 * Result from dispatching a raw message.
 */
export interface DispatchResult {
  selectedResponse?: Response;
}

/**
 * Logger interface for VMRouter.
 */
export interface ILogger {
  error(message: string, error?: Error): void;
}

/**
 * Default console-based logger.
 */
const defaultLogger: ILogger = {
  error(message: string, error?: Error): void {
    if (error) {
      console.error(message, error);
    } else {
      console.error(message);
    }
  },
};

/**
 * Singleton controllers for VMRouter.
 * These should be set during application startup.
 */
let channelController: IChannelController | null = null;
let engineController: IEngineController | null = null;

/**
 * Set the channel controller for VMRouter to use.
 * This should be called during application startup.
 */
export function setChannelController(controller: IChannelController): void {
  channelController = controller;
}

/**
 * Set the engine controller for VMRouter to use.
 * This should be called during application startup.
 */
export function setEngineController(controller: IEngineController): void {
  engineController = controller;
}

/**
 * Get the current channel controller.
 */
export function getChannelController(): IChannelController | null {
  return channelController;
}

/**
 * Get the current engine controller.
 */
export function getEngineController(): IEngineController | null {
  return engineController;
}

/**
 * Utility class used to dispatch messages to channels.
 */
export class VMRouter {
  private logger: ILogger;
  private channelCtrl: IChannelController;
  private engineCtrl: IEngineController;

  /**
   * Instantiates a VMRouter object.
   *
   * @param logger Optional logger instance (defaults to console).
   * @param customChannelController Optional channel controller (defaults to global singleton).
   * @param customEngineController Optional engine controller (defaults to global singleton).
   */
  constructor(
    logger?: ILogger,
    customChannelController?: IChannelController,
    customEngineController?: IEngineController
  ) {
    this.logger = logger ?? defaultLogger;

    // Use provided controllers or fall back to singletons
    if (customChannelController) {
      this.channelCtrl = customChannelController;
    } else if (channelController) {
      this.channelCtrl = channelController;
    } else {
      throw new Error(
        'No channel controller available. Call setChannelController() during startup.'
      );
    }

    if (customEngineController) {
      this.engineCtrl = customEngineController;
    } else if (engineController) {
      this.engineCtrl = engineController;
    } else {
      throw new Error(
        'No engine controller available. Call setEngineController() during startup.'
      );
    }
  }

  /**
   * Dispatches a message to a channel, specified by the deployed channel name. If the dispatch
   * fails for any reason (for example, if the target channel is not started), a Response object
   * with the ERROR status and the error message will be returned.
   *
   * @param channelName The name of the deployed channel to dispatch the message to.
   * @param message The message to dispatch to the channel.
   * @return The Response object returned by the channel, if its source connector is configured to
   *         return one.
   */
  routeMessage(channelName: string, message: string): Promise<Response | null>;

  /**
   * Dispatches a message to a channel, specified by the deployed channel name. If the dispatch
   * fails for any reason (for example, if the target channel is not started), a Response object
   * with the ERROR status and the error message will be returned.
   *
   * @param channelName The name of the deployed channel to dispatch the message to.
   * @param rawMessage A RawMessage object to dispatch to the channel.
   * @return The Response object returned by the channel, if its source connector is configured to
   *         return one.
   */
  routeMessage(channelName: string, rawMessage: RawMessage): Promise<Response | null>;

  // Implementation
  async routeMessage(
    channelName: string,
    messageOrRaw: string | RawMessage
  ): Promise<Response | null> {
    const rawMessage =
      typeof messageOrRaw === 'string' ? new RawMessage(messageOrRaw) : messageOrRaw;

    const channel = this.channelCtrl.getDeployedChannelByName(channelName);

    if (channel === null) {
      const errorMsg = `Could not find channel to route to for channel name: ${channelName}`;
      this.logger.error(errorMsg);
      return new Response({
        status: Status.ERROR,
        message: errorMsg,
        statusMessage: errorMsg,
      });
    }

    return this.routeMessageByChannelId(channel.id, rawMessage);
  }

  /**
   * Dispatches a message to a channel, specified by the deployed channel ID. If the dispatch
   * fails for any reason (for example, if the target channel is not started), a Response object
   * with the ERROR status and the error message will be returned.
   *
   * @param channelId The ID of the deployed channel to dispatch the message to.
   * @param message The message to dispatch to the channel.
   * @return The Response object returned by the channel, if its source connector is configured to
   *         return one.
   */
  routeMessageByChannelId(channelId: string, message: string): Promise<Response | null>;

  /**
   * Dispatches a message to a channel, specified by the deployed channel ID. If the dispatch
   * fails for any reason (for example, if the target channel is not started), a Response object
   * with the ERROR status and the error message will be returned.
   *
   * @param channelId The ID of the deployed channel to dispatch the message to.
   * @param rawMessage A RawMessage object to dispatch to the channel.
   * @return The Response object returned by the channel, if its source connector is configured to
   *         return one.
   */
  routeMessageByChannelId(channelId: string, rawMessage: RawMessage): Promise<Response | null>;

  // Implementation
  async routeMessageByChannelId(
    channelId: string,
    messageOrRaw: string | RawMessage
  ): Promise<Response | null> {
    const rawMessage =
      typeof messageOrRaw === 'string' ? new RawMessage(messageOrRaw) : messageOrRaw;

    try {
      const dispatchResult = await this.engineCtrl.dispatchRawMessage(
        channelId,
        {
          rawData: rawMessage.getRawData(),
          rawBytes: rawMessage.getRawBytes(),
          destinationMetaDataIds: rawMessage.getDestinationMetaDataIds(),
          sourceMap: rawMessage.getSourceMap(),
        },
        false, // force
        true // storeRawResponse
      );

      let response: Response | null = null;
      if (dispatchResult?.selectedResponse) {
        response = dispatchResult.selectedResponse;
      }

      return response;
    } catch (e) {
      const baseMessage = `Error routing message to channel id: ${channelId}`;
      const error = e instanceof Error ? e : new Error(String(e));
      this.logger.error(baseMessage, error);

      const responseStatusMessage = buildErrorResponse(baseMessage, error);
      const responseError = buildErrorMessage('VMRouter', baseMessage, error);

      return new Response({
        status: Status.ERROR,
        message: undefined,
        statusMessage: responseStatusMessage,
        error: responseError,
      });
    }
  }
}

/**
 * Build an error response message.
 */
function buildErrorResponse(message: string, error: Error): string {
  return `${message}: ${error.message}`;
}

/**
 * Build a detailed error message.
 */
function buildErrorMessage(className: string, message: string, error: Error): string {
  const stack = error.stack ?? '';
  return `${className}: ${message}\n${error.message}\n${stack}`;
}
