/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/RecoveryTask.java
 *
 * Recovers unfinished messages on channel startup.
 * Finds messages where PROCESSED=0 and connector messages with status R (RECEIVED) or P (PENDING),
 * then marks them as ERROR since they can't be meaningfully resumed.
 */

import {
  getUnfinishedMessagesByServerId,
  getConnectorMessagesByStatus,
  updateConnectorMessageStatus,
  updateErrors,
  updateStatistics,
  updateMessageProcessed,
} from '../../db/DonkeyDao.js';
import { transaction } from '../../db/pool.js';
import { Status } from '../../model/Status.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('engine', 'Channel deploy/start/stop');
const logger = getLogger('engine');

export interface RecoveryResult {
  recovered: number;
  errors: number;
}

export async function runRecoveryTask(
  channelId: string,
  serverId: string
): Promise<RecoveryResult> {
  const result: RecoveryResult = { recovered: 0, errors: 0 };

  try {
    // Find unfinished messages (PROCESSED=0) owned by this server instance.
    // In a cluster, each instance only recovers its own messages.
    const unfinished = await getUnfinishedMessagesByServerId(channelId, serverId);

    if (unfinished.length === 0) {
      return result;
    }

    for (const msg of unfinished) {
      try {
        // Find pending connector messages for this message
        const pending = await getConnectorMessagesByStatus(
          channelId, [Status.RECEIVED, Status.PENDING], msg.ID
        );

        // Wrap all recovery operations for this message in a single transaction
        await transaction(async (conn) => {
          // Mark pending connectors as ERROR
          for (const cm of pending) {
            await updateConnectorMessageStatus(
              channelId, cm.MESSAGE_ID, cm.METADATA_ID, Status.ERROR, conn
            );

            // Store recovery error content
            const errorMsg = `Message recovered after server restart. Original status: ${cm.STATUS}`;
            await updateErrors(
              channelId, cm.MESSAGE_ID, cm.METADATA_ID,
              errorMsg, undefined, undefined, undefined, conn
            );

            // Update error statistics
            await updateStatistics(channelId, cm.METADATA_ID, serverId, Status.ERROR, 1, conn);

            result.errors++;
          }

          // Mark message as processed
          await updateMessageProcessed(channelId, msg.ID, true, conn);
        });

        result.recovered++;
      } catch (err) {
        logger.error(`[RecoveryTask] Error recovering message ${msg.ID}: ${err}`);
      }
    }

    if (result.recovered > 0) {
      logger.info(`[RecoveryTask] Recovered ${result.recovered} unfinished messages (${result.errors} marked as ERROR) for channel ${channelId}`);
    }
  } catch (err) {
    logger.error(`[RecoveryTask] Failed to run recovery for channel ${channelId}: ${err}`);
  }

  return result;
}
