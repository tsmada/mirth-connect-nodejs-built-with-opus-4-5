/**
 * Mirth Connect Node.js Runtime
 *
 * Entry point for the Node.js replacement of Mirth Connect Java engine.
 * Maintains 100% API compatibility with Mirth Connect Administrator.
 */

import { Mirth } from './server/Mirth.js';

async function main(): Promise<void> {
  const mirth = new Mirth();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.warn('Received SIGINT, shutting down...');
    await mirth.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.warn('Received SIGTERM, shutting down...');
    await mirth.stop();
    process.exit(0);
  });

  try {
    await mirth.start();
  } catch (error) {
    console.error('Failed to start Mirth Connect:', error);
    process.exit(1);
  }
}

void main();
