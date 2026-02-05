/**
 * Dashboard Command
 *
 * Interactive terminal dashboard for monitoring channels.
 * Uses Ink (React for CLI) for rendering with real-time WebSocket updates.
 */

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { ApiClient, ApiError } from '../lib/ApiClient.js';
import { ConfigManager } from '../lib/ConfigManager.js';
import { GlobalOptions } from '../types/index.js';
import { Dashboard } from '../ui/components/Dashboard.js';

// =============================================================================
// Dashboard Command Registration
// =============================================================================

/**
 * Register dashboard command
 */
export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .alias('dash')
    .description('Interactive channel dashboard with real-time updates')
    .option('-r, --refresh <seconds>', 'Polling refresh interval in seconds (fallback)', '5')
    .option('--no-websocket', 'Disable WebSocket, use polling only')
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;

      // JSON mode doesn't make sense for interactive dashboard
      if (globalOpts.json) {
        console.error('Dashboard does not support JSON output mode.');
        console.error('Use "mirth-cli channels --json" for JSON output.');
        process.exit(1);
      }

      const client = new ApiClient({
        baseUrl: globalOpts.url || ConfigManager.getServerUrl(),
        verbose: globalOpts.verbose,
      });

      const refreshInterval = parseInt(options.refresh, 10);
      const enableWebSocket = options.websocket !== false;

      // Check authentication first
      try {
        await client.getChannelStatuses();
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 401) {
          console.error('Not authenticated. Please run "mirth-cli login" first.');
          process.exit(1);
        }
        console.error('Failed to connect to server:', (error as Error).message);
        process.exit(1);
      }

      // Render the enhanced dashboard
      const { waitUntilExit } = render(
        React.createElement(Dashboard, {
          client,
          refreshInterval,
          enableWebSocket,
        })
      );

      await waitUntilExit();
    });
}

export default registerDashboardCommand;
