/**
 * Validate command - Run validation against a specific Java Mirth version.
 */

import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { parseVersion, KNOWN_VERSIONS } from '../models/Version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const VALIDATION_DIR = path.join(PROJECT_ROOT, 'validation');

interface ValidateOptions {
  deployJava?: boolean;
  scenarios?: string;
  priority?: string;
}

export async function validateCommand(
  version: string,
  options: ValidateOptions
): Promise<void> {
  try {
    parseVersion(version);

    const versionInfo = KNOWN_VERSIONS[version];
    if (!versionInfo) {
      console.log(
        chalk.yellow(`Warning: Version ${version} not in known versions list. Proceeding anyway.`)
      );
    }

    console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════════════════'));
    console.log(chalk.bold(`  Validation for Mirth ${version}`));
    console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════\n'));

    // Docker image for this version
    const dockerImage = `nextgenhealthcare/connect:${version}`;
    console.log(`  Docker Image: ${chalk.yellow(dockerImage)}`);

    if (options.deployJava) {
      console.log();
      console.log(chalk.bold('Starting Java Mirth container...'));
      await startJavaMirthContainer(version);
    }

    // Build validation command
    const args = ['run', 'validate'];
    if (options.scenarios) {
      args.push('--', '--scenario', options.scenarios);
    }
    if (options.priority) {
      args.push('--', '--priority', options.priority);
    }

    console.log();
    console.log(chalk.bold('Running validation suite...'));
    console.log(chalk.dim(`  cd ${VALIDATION_DIR}`));
    console.log(chalk.dim(`  npm ${args.join(' ')}`));
    console.log();

    // Run validation
    const result = await runValidation(args);

    if (result.exitCode === 0) {
      console.log(chalk.green('\n✓ Validation passed!'));
    } else {
      console.log(chalk.red('\n✗ Validation failed.'));
      console.log(
        chalk.dim(`  See reports in: ${path.join(VALIDATION_DIR, 'reports')}`)
      );
    }

    // Report location
    console.log();
    console.log(chalk.bold('Reports:'));
    console.log(`  ${chalk.dim(path.join(VALIDATION_DIR, 'reports', `validation-${version}`))}`)
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error:'), error.message);
    } else {
      console.error(chalk.red('Error:'), error);
    }
    process.exit(1);
  }
}

async function startJavaMirthContainer(version: string): Promise<void> {
  const dockerImage = `nextgenhealthcare/connect:${version}`;

  console.log(chalk.dim(`  Pulling ${dockerImage}...`));

  // This is a placeholder - actual implementation would use Docker API
  console.log(
    chalk.yellow(
      `\n  Note: Container management not yet implemented.`
    )
  );
  console.log(chalk.yellow(`  Manually start the container with:`));
  console.log(
    chalk.dim(`    docker run -d -p 8443:8443 -p 6661:6661 ${dockerImage}`)
  );
  console.log();
}

async function runValidation(
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Check if validation directory exists
    const child = spawn('npm', args, {
      cwd: VALIDATION_DIR,
      stdio: 'inherit',
      shell: true,
    });

    child.on('error', (err) => {
      console.log(
        chalk.yellow(`\nValidation suite not available: ${err.message}`)
      );
      console.log(chalk.dim('  Make sure to run: cd validation && npm install'));
      resolve({ exitCode: 1, stdout: '', stderr: err.message });
    });

    child.on('close', (code) => {
      resolve({ exitCode: code || 0, stdout: '', stderr: '' });
    });
  });
}
