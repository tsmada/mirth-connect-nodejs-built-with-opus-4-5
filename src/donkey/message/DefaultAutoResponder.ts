import type { AutoResponder } from './AutoResponder.js';
import { Response } from '../../model/Response.js';
import type { Status } from '../../model/Status.js';

/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/components/DefaultAutoResponder.java
 *
 * Default implementation that returns a Response with null content.
 * Used when no data-type-specific auto-responder is configured.
 */
export class DefaultAutoResponder implements AutoResponder {
  getResponse(_rawMessage: string, _processedMessage: string | null, status: Status): Response {
    return new Response(status, null as unknown as string);
  }
}
