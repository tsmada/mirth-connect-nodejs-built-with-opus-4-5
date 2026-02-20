import type { Response } from '../../model/Response.js';
import type { Status } from '../../model/Status.js';

/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/components/AutoResponder.java
 *
 * Interface for generating automatic responses to source messages.
 * Called by SourceConnector when no response transformer is configured.
 */
export interface AutoResponder {
  getResponse(rawMessage: string, processedMessage: string | null, status: Status): Response;
}
