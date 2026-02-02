/**
 * Send Commands
 *
 * Commands for sending messages via MLLP and HTTP protocols.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import {
  sendMLLP,
  sendHTTP,
  readMessage,
  parseHostPort,
} from '../lib/MessageSender.js';
import { OutputFormatter, formatDuration } from '../lib/OutputFormatter.js';
import { GlobalOptions } from '../types/index.js';

/**
 * Register send commands
 */
export function registerSendCommands(program: Command): void {
  const sendCmd = program
    .command('send')
    .description('Send messages to endpoints');

  // ==========================================================================
  // send mllp <host:port> <message|@file>
  // ==========================================================================
  sendCmd
    .command('mllp <hostPort> <message>')
    .description('Send a message via MLLP')
    .option('-t, --timeout <ms>', 'Connection timeout in milliseconds', '30000')
    .option('-r, --raw', 'Show raw response')
    .action(async (hostPort: string, message: string, options, _, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        // Parse host:port
        const { host, port } = parseHostPort(hostPort);

        // Read message (may be from file)
        const messageContent = readMessage(message);

        const spinner = ora(`Sending to ${host}:${port}...`).start();

        const result = await sendMLLP(messageContent, {
          host,
          port,
          timeout: parseInt(options.timeout, 10),
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.success) {
            console.log(chalk.green('✔') + ' ' + chalk.bold('Message sent successfully'));
          } else {
            console.log(chalk.red('✖') + ' ' + chalk.bold('Message send failed'));
          }
          console.log();
          console.log(`  ${chalk.gray('Destination:')} ${host}:${port}`);
          console.log(`  ${chalk.gray('Duration:')}    ${formatDuration(result.duration || 0)}`);
          console.log(`  ${chalk.gray('Response:')}    ${result.message}`);

          if (result.error) {
            console.log(`  ${chalk.gray('Error:')}       ${chalk.red(result.error)}`);
          }

          if (options.raw && result.response) {
            console.log();
            console.log(chalk.bold('Raw Response:'));
            // Format HL7 segments on separate lines
            const formatted = result.response.replace(/\r/g, '\n');
            console.log(chalk.gray(formatted));
          }
        }

        if (!result.success) {
          process.exit(1);
        }
      } catch (error) {
        formatter.error('Failed to send message', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // send http <url> <message|@file>
  // ==========================================================================
  sendCmd
    .command('http <url> <message>')
    .description('Send a message via HTTP')
    .option('-m, --method <method>', 'HTTP method', 'POST')
    .option('-c, --content-type <type>', 'Content-Type header', 'text/plain')
    .option('-H, --header <header>', 'Additional header (format: key:value)', (v, prev: string[]) => [...prev, v], [])
    .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '30000')
    .option('-r, --raw', 'Show raw response')
    .action(async (url: string, message: string, options, _, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      try {
        // Read message (may be from file)
        const messageContent = readMessage(message);

        // Parse headers
        const headers: Record<string, string> = {
          'Content-Type': options.contentType,
        };
        for (const header of options.header) {
          const colonIdx = header.indexOf(':');
          if (colonIdx > 0) {
            const key = header.slice(0, colonIdx).trim();
            const value = header.slice(colonIdx + 1).trim();
            headers[key] = value;
          }
        }

        const spinner = ora(`Sending to ${url}...`).start();

        const result = await sendHTTP(messageContent, {
          url,
          method: options.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE',
          headers,
          timeout: parseInt(options.timeout, 10),
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.success) {
            console.log(chalk.green('✔') + ' ' + chalk.bold('Request successful'));
          } else {
            console.log(chalk.red('✖') + ' ' + chalk.bold('Request failed'));
          }
          console.log();
          console.log(`  ${chalk.gray('URL:')}        ${url}`);
          console.log(`  ${chalk.gray('Method:')}     ${options.method.toUpperCase()}`);
          console.log(`  ${chalk.gray('Duration:')}   ${formatDuration(result.duration || 0)}`);
          if (result.statusCode) {
            const statusColor = result.success ? chalk.green : chalk.red;
            console.log(`  ${chalk.gray('Status:')}     ${statusColor(result.statusCode)}`);
          }

          if (result.error) {
            console.log(`  ${chalk.gray('Error:')}      ${chalk.red(result.error)}`);
          }

          if (options.raw && result.response) {
            console.log();
            console.log(chalk.bold('Response:'));
            // Try to pretty-print JSON
            try {
              const parsed = JSON.parse(result.response);
              console.log(chalk.gray(JSON.stringify(parsed, null, 2)));
            } catch {
              console.log(chalk.gray(result.response));
            }
          }
        }

        if (!result.success) {
          process.exit(1);
        }
      } catch (error) {
        formatter.error('Failed to send request', (error as Error).message);
        process.exit(1);
      }
    });

  // ==========================================================================
  // Helpful alias for sending test HL7 messages
  // ==========================================================================
  sendCmd
    .command('hl7 <hostPort> [message]')
    .description('Send an HL7 message (shorthand for mllp with default test message)')
    .option('-t, --timeout <ms>', 'Connection timeout in milliseconds', '30000')
    .option('-r, --raw', 'Show raw response')
    .action(async (hostPort: string, message: string | undefined, options, _, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
      const formatter = new OutputFormatter(globalOpts.json);

      // Default test ADT message if none provided
      const defaultMessage = [
        'MSH|^~\\&|SENDING_APP|SENDING_FAC|RECEIVING_APP|RECEIVING_FAC|' +
          new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) +
          '||ADT^A01|' + Date.now() + '|P|2.5.1',
        'EVN|A01|' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
        'PID|1||123456^^^MRN||Doe^John^Q||19800101|M|||123 Main St^^City^ST^12345||555-123-4567',
        'PV1|1|I|WARD^ROOM^BED',
      ].join('\r');

      const messageContent = message ? readMessage(message) : defaultMessage;

      try {
        const { host, port } = parseHostPort(hostPort);
        const spinner = ora(`Sending HL7 to ${host}:${port}...`).start();

        const result = await sendMLLP(messageContent, {
          host,
          port,
          timeout: parseInt(options.timeout, 10),
        });

        spinner.stop();

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.success) {
            console.log(chalk.green('✔') + ' ' + chalk.bold('HL7 message sent successfully'));
          } else {
            console.log(chalk.red('✖') + ' ' + chalk.bold('HL7 message send failed'));
          }
          console.log();
          console.log(`  ${chalk.gray('Response:')} ${result.message}`);

          if (options.raw && result.response) {
            console.log();
            console.log(chalk.bold('ACK:'));
            const formatted = result.response.replace(/\r/g, '\n');
            console.log(chalk.gray(formatted));
          }
        }

        if (!result.success) {
          process.exit(1);
        }
      } catch (error) {
        formatter.error('Failed to send HL7 message', (error as Error).message);
        process.exit(1);
      }
    });
}

export default registerSendCommands;
