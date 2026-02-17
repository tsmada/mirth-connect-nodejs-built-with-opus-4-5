/**
 * Mirth Connect Node.js Runtime
 *
 * Entry point for the Node.js replacement of Mirth Connect Java engine.
 * Maintains 100% API compatibility with Mirth Connect Administrator.
 */

import 'dotenv/config';
import { Mirth } from './server/Mirth.js';
import { getLogger, registerComponent } from './logging/index.js';

registerComponent('server', 'Server lifecycle');
const logger = getLogger('server');

let mirth: Mirth | null = null;

/**
 * Attempt graceful shutdown with a safety timeout.
 * If mirth.stop() hangs, force-exit after 5 seconds.
 */
async function gracefulShutdown(): Promise<void> {
  if (!mirth) return;
  const timeout = setTimeout(() => {
    process.exit(1);
  }, 5000);
  try {
    await mirth.stop();
  } finally {
    clearTimeout(timeout);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  try { logger.warn('Received SIGINT, shutting down...'); } catch { console.error('Received SIGINT, shutting down...'); }
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  try { logger.warn('Received SIGTERM, shutting down...'); } catch { console.error('Received SIGTERM, shutting down...'); }
  await gracefulShutdown();
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason: unknown) => {
  try {
    logger.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
  } catch {
    console.error('Unhandled promise rejection:', reason);
  }
  await gracefulShutdown();
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error: Error) => {
  try {
    logger.error('Uncaught exception', error);
  } catch {
    console.error('Uncaught exception:', error);
  }
  await gracefulShutdown();
  process.exit(1);
});

async function main(): Promise<void> {
  mirth = new Mirth();

  try {
    await mirth.start();
  } catch (error) {
    try {
      logger.error('Failed to start Mirth Connect:', error instanceof Error ? error : new Error(String(error)));
    } catch {
      console.error('Failed to start Mirth Connect:', error);
    }
    process.exit(1);
  }
}

void main();
