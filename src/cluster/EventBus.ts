/**
 * Event Bus
 *
 * Abstract pub/sub system for cluster-wide event distribution.
 * Enables dashboard federation, status broadcasts, and inter-node notifications.
 *
 * Three implementations:
 * - LocalEventBus: In-process dispatch (single-node, no persistence)
 * - DatabasePollingEventBus: MySQL-backed polling (fallback, no Redis required)
 * - RedisEventBus: Redis pub/sub (preferred for low-latency clustered mode)
 */

import { RowDataPacket } from 'mysql2/promise';
import { query, execute } from '../db/pool.js';
import { getClusterConfig } from './ClusterConfig.js';
import { getServerId } from './ClusterIdentity.js';
import { getLogger, registerComponent } from '../logging/index.js';

registerComponent('cluster', 'Cluster operations');
const logger = getLogger('cluster');

export interface EventBus {
  publish(channel: string, data: unknown): Promise<void>;
  subscribe(channel: string, handler: (data: unknown) => void): void;
  unsubscribe(channel: string, handler: (data: unknown) => void): void;
  close(): Promise<void>;
}

type EventHandler = (data: unknown) => void;

/**
 * Single-node event bus with in-process dispatch.
 * No external dependencies — subscribers receive events synchronously.
 */
export class LocalEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  async publish(channel: string, data: unknown): Promise<void> {
    const channelHandlers = this.handlers.get(channel);
    if (!channelHandlers) return;

    for (const handler of channelHandlers) {
      try {
        handler(data);
      } catch (err) {
        logger.error(`[LocalEventBus] Handler error on channel "${channel}":`, err as Error);
      }
    }
  }

  subscribe(channel: string, handler: EventHandler): void {
    let channelHandlers = this.handlers.get(channel);
    if (!channelHandlers) {
      channelHandlers = new Set();
      this.handlers.set(channel, channelHandlers);
    }
    channelHandlers.add(handler);
  }

  unsubscribe(channel: string, handler: EventHandler): void {
    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      channelHandlers.delete(handler);
      if (channelHandlers.size === 0) {
        this.handlers.delete(channel);
      }
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

interface ClusterEventRow extends RowDataPacket {
  ID: number;
  CHANNEL: string;
  DATA: string;
  CREATED_AT: Date;
  SERVER_ID: string;
}

/**
 * Database-polling event bus.
 * Falls back to polling D_CLUSTER_EVENTS when Redis is unavailable.
 * Events from this server are written to the table; events from other
 * servers are polled and dispatched to local subscribers.
 */
export class DatabasePollingEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private lastSeenId = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private serverId: string;
  private pollInterval: number;

  constructor(pollInterval: number = 2000) {
    this.serverId = getServerId();
    this.pollInterval = pollInterval;
  }

  /**
   * Start polling for new events.
   * Must be called after construction; separated so tests can control timing.
   */
  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
    this.pollTimer.unref();
  }

  async publish(channel: string, data: unknown): Promise<void> {
    // Write to database for other instances to pick up
    await execute(
      `INSERT INTO D_CLUSTER_EVENTS (CHANNEL, DATA, CREATED_AT, SERVER_ID)
       VALUES (:channel, :data, NOW(), :serverId)`,
      { channel, data: JSON.stringify(data), serverId: this.serverId }
    );

    // Also dispatch locally (so local subscribers don't wait for the poll)
    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      for (const handler of channelHandlers) {
        try {
          handler(data);
        } catch (err) {
          logger.error(
            `[DatabasePollingEventBus] Handler error on channel "${channel}":`,
            err as Error
          );
        }
      }
    }
  }

  subscribe(channel: string, handler: EventHandler): void {
    let channelHandlers = this.handlers.get(channel);
    if (!channelHandlers) {
      channelHandlers = new Set();
      this.handlers.set(channel, channelHandlers);
    }
    channelHandlers.add(handler);
  }

  unsubscribe(channel: string, handler: EventHandler): void {
    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      channelHandlers.delete(handler);
      if (channelHandlers.size === 0) {
        this.handlers.delete(channel);
      }
    }
  }

  async close(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.handlers.clear();
  }

  /**
   * Poll for new events from other server instances.
   */
  private async poll(): Promise<void> {
    try {
      const rows = await query<ClusterEventRow>(
        `SELECT ID, CHANNEL, DATA, CREATED_AT, SERVER_ID
         FROM D_CLUSTER_EVENTS
         WHERE ID > :lastSeenId AND SERVER_ID != :serverId
         ORDER BY ID ASC
         LIMIT 100`,
        { lastSeenId: this.lastSeenId, serverId: this.serverId }
      );

      for (const row of rows) {
        this.lastSeenId = row.ID;
        const channelHandlers = this.handlers.get(row.CHANNEL);
        if (channelHandlers) {
          let data: unknown;
          try {
            data = JSON.parse(row.DATA);
          } catch {
            data = row.DATA;
          }

          for (const handler of channelHandlers) {
            try {
              handler(data);
            } catch (err) {
              logger.error(
                `[DatabasePollingEventBus] Poll handler error on "${row.CHANNEL}":`,
                err as Error
              );
            }
          }
        }
      }
    } catch (err) {
      logger.error('[DatabasePollingEventBus] Poll error', err as Error);
    }
  }
}

/**
 * Redis pub/sub event bus.
 * Preferred for clustered mode — low latency, no polling.
 * Requires ioredis as an optional dependency.
 */
export class RedisEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private pubClient: unknown = null;
  private subClient: unknown = null;

  constructor(redisUrl: string) {
    try {
      // Dynamic import check — ioredis is optional
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      this.pubClient = new Redis(redisUrl);
      this.subClient = new Redis(redisUrl);

      // Set up message handler on sub client
      (this.subClient as { on: (event: string, handler: (...args: string[]) => void) => void }).on(
        'message',
        (channel: string, message: string) => {
          const channelHandlers = this.handlers.get(channel);
          if (channelHandlers) {
            let data: unknown;
            try {
              data = JSON.parse(message);
            } catch {
              data = message;
            }
            for (const handler of channelHandlers) {
              try {
                handler(data);
              } catch (err) {
                logger.error(
                  `[RedisEventBus] Handler error on channel "${channel}":`,
                  err as Error
                );
              }
            }
          }
        }
      );
    } catch {
      throw new Error('ioredis is required for RedisEventBus. Install with: npm install ioredis');
    }
  }

  async publish(channel: string, data: unknown): Promise<void> {
    const pub = this.pubClient as { publish: (ch: string, msg: string) => Promise<number> };
    await pub.publish(channel, JSON.stringify(data));
  }

  subscribe(channel: string, handler: EventHandler): void {
    let channelHandlers = this.handlers.get(channel);
    const isNewChannel = !channelHandlers;

    if (!channelHandlers) {
      channelHandlers = new Set();
      this.handlers.set(channel, channelHandlers);
    }
    channelHandlers.add(handler);

    // Subscribe to Redis channel if first handler
    if (isNewChannel) {
      const sub = this.subClient as { subscribe: (ch: string) => Promise<number> };
      sub.subscribe(channel).catch((err: Error) => {
        logger.error(`[RedisEventBus] Failed to subscribe to "${channel}":`, err);
      });
    }
  }

  unsubscribe(channel: string, handler: EventHandler): void {
    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      channelHandlers.delete(handler);
      if (channelHandlers.size === 0) {
        this.handlers.delete(channel);
        const sub = this.subClient as { unsubscribe: (ch: string) => Promise<number> };
        sub.unsubscribe(channel).catch((err: Error) => {
          logger.error(`[RedisEventBus] Failed to unsubscribe from "${channel}":`, err);
        });
      }
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
    const quit = async (client: unknown) => {
      if (client) {
        await (client as { quit: () => Promise<string> }).quit();
      }
    };
    await quit(this.subClient);
    await quit(this.pubClient);
    this.subClient = null;
    this.pubClient = null;
  }
}

/**
 * Factory: create the appropriate EventBus based on cluster configuration.
 *
 * Priority:
 * 1. If Redis URL is configured → RedisEventBus
 * 2. If cluster is enabled → DatabasePollingEventBus
 * 3. Otherwise → LocalEventBus
 */
export function createEventBus(): EventBus {
  const config = getClusterConfig();

  if (config.redisUrl) {
    try {
      return new RedisEventBus(config.redisUrl);
    } catch (err) {
      logger.warn('Redis unavailable, falling back to database polling');
    }
  }

  if (config.clusterEnabled) {
    const bus = new DatabasePollingEventBus();
    bus.start();
    return bus;
  }

  return new LocalEventBus();
}
