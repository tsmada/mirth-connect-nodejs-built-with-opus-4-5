import * as fs from 'fs';
import * as path from 'path';
import { environment, Environment } from '../config/environments';
import { MirthApiClient, createClients } from '../clients/MirthApiClient';
import { ScenarioRunner, ScenarioResult, ScenarioConfig } from './ScenarioRunner';

export interface ValidationReport {
  timestamp: string;
  environment: {
    javaUrl: string;
    nodeUrl: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  scenarios: ScenarioResult[];
  gaps: ValidationGap[];
}

export interface ValidationGap {
  id: string;
  scenarioId: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  javaOutput?: string;
  nodeOutput?: string;
  status: 'open' | 'investigating' | 'resolved';
}

export interface ValidationOptions {
  priority?: number;
  scenarioIds?: string[];
  stopOnFailure?: boolean;
  verbose?: boolean;
}

export class ValidationRunner {
  private env: Environment;
  private javaClient: MirthApiClient;
  private nodeClient: MirthApiClient;
  private scenarioRunner: ScenarioRunner;
  private gaps: ValidationGap[] = [];
  private gapCounter = 0;

  constructor(env: Environment = environment) {
    this.env = env;
    const clients = createClients(env.java, env.node);
    this.javaClient = clients.java;
    this.nodeClient = clients.node;
    this.scenarioRunner = new ScenarioRunner(this.javaClient, this.nodeClient, env);
  }

  /**
   * Run all validation scenarios
   */
  async runAll(options: ValidationOptions = {}): Promise<ValidationReport> {
    const scenarios = this.loadScenarios(options.priority);
    return this.runScenarios(scenarios, options);
  }

  /**
   * Run specific scenarios by ID
   */
  async runScenarios(
    scenarios: ScenarioConfig[],
    options: ValidationOptions = {}
  ): Promise<ValidationReport> {
    console.log('='.repeat(60));
    console.log('Mirth Connect Validation Suite');
    console.log('='.repeat(60));
    console.log(`Java Mirth: ${this.env.java.baseUrl}`);
    console.log(`Node.js Mirth: ${this.env.node.baseUrl}`);
    console.log(`Scenarios to run: ${scenarios.length}`);
    console.log('='.repeat(60));

    // Login to both engines
    console.log('\nAuthenticating...');
    const javaLogin = await this.javaClient.login();
    const nodeLogin = await this.nodeClient.login();

    if (!javaLogin) {
      console.error('Failed to login to Java Mirth');
    }
    if (!nodeLogin) {
      console.error('Failed to login to Node.js Mirth');
    }

    const results: ScenarioResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const scenario of scenarios) {
      if (options.scenarioIds && !options.scenarioIds.includes(scenario.id)) {
        skipped++;
        continue;
      }

      console.log(`\n[${scenario.id}] ${scenario.name}...`);

      try {
        const result = await this.scenarioRunner.run(scenario);
        results.push(result);

        if (result.passed) {
          passed++;
          console.log(`  PASSED`);
        } else {
          failed++;
          console.log(`  FAILED: ${result.error || 'Unknown error'}`);

          // Record gaps
          for (const diff of result.differences) {
            this.recordGap(scenario.id, diff);
          }

          if (options.stopOnFailure) {
            console.log('\nStopping due to failure (--stop-on-failure)');
            break;
          }
        }

        if (options.verbose && result.differences.length > 0) {
          console.log('  Differences:');
          for (const diff of result.differences.slice(0, 5)) {
            console.log(`    - ${diff.description}`);
          }
          if (result.differences.length > 5) {
            console.log(`    ... and ${result.differences.length - 5} more`);
          }
        }
      } catch (error) {
        failed++;
        console.log(`  ERROR: ${(error as Error).message}`);
        results.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          passed: false,
          error: (error as Error).message,
          differences: [],
          javaResponse: undefined,
          nodeResponse: undefined,
          duration: 0,
        });
      }
    }

    // Logout
    await this.javaClient.logout();
    await this.nodeClient.logout();

    // Generate report
    const report: ValidationReport = {
      timestamp: new Date().toISOString(),
      environment: {
        javaUrl: this.env.java.baseUrl,
        nodeUrl: this.env.node.baseUrl,
      },
      summary: {
        total: scenarios.length,
        passed,
        failed,
        skipped,
      },
      scenarios: results,
      gaps: this.gaps,
    };

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total:   ${report.summary.total}`);
    console.log(`Passed:  ${report.summary.passed}`);
    console.log(`Failed:  ${report.summary.failed}`);
    console.log(`Skipped: ${report.summary.skipped}`);
    console.log(`Gaps:    ${this.gaps.length}`);
    console.log('='.repeat(60));

    // Save report
    this.saveReport(report);

    return report;
  }

  /**
   * Load scenario configurations from filesystem
   */
  private loadScenarios(priority?: number): ScenarioConfig[] {
    const scenariosDir = path.join(__dirname, '..', 'scenarios');
    const scenarios: ScenarioConfig[] = [];

    // Get all scenario directories
    const dirs = fs.readdirSync(scenariosDir).filter((d) => {
      const fullPath = path.join(scenariosDir, d);
      return fs.statSync(fullPath).isDirectory();
    });

    // Sort by priority (directory name prefix)
    dirs.sort();

    for (const dir of dirs) {
      // Extract priority from directory name (e.g., "00-export-compatibility" -> 0)
      const dirPriority = parseInt(dir.split('-')[0], 10);

      if (priority !== undefined && dirPriority !== priority) {
        continue;
      }

      const scenarioDir = path.join(scenariosDir, dir);
      const configFile = path.join(scenarioDir, 'config.json');

      if (fs.existsSync(configFile)) {
        try {
          const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
          scenarios.push({
            ...config,
            basePath: scenarioDir,
          });
        } catch (error) {
          console.warn(`Warning: Failed to load scenario config from ${configFile}`);
        }
      }
    }

    return scenarios;
  }

  /**
   * Record a validation gap
   */
  private recordGap(
    scenarioId: string,
    diff: { description: string; expected?: unknown; actual?: unknown; severity?: string }
  ): void {
    this.gapCounter++;
    this.gaps.push({
      id: `gap-${String(this.gapCounter).padStart(3, '0')}`,
      scenarioId,
      severity: (diff.severity as 'critical' | 'major' | 'minor') || 'major',
      description: diff.description,
      javaOutput: diff.expected ? String(diff.expected) : undefined,
      nodeOutput: diff.actual ? String(diff.actual) : undefined,
      status: 'open',
    });
  }

  /**
   * Save validation report to file
   */
  private saveReport(report: ValidationReport): void {
    const reportsDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportsDir, `validation-${timestamp}.json`);

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${reportFile}`);
  }
}

// CLI entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: ValidationOptions = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    stopOnFailure: args.includes('--stop-on-failure'),
  };

  // Parse --priority flag
  const priorityIndex = args.indexOf('--priority');
  if (priorityIndex !== -1 && args[priorityIndex + 1]) {
    options.priority = parseInt(args[priorityIndex + 1], 10);
  }

  // Parse --scenario flag
  const scenarioIndex = args.indexOf('--scenario');
  if (scenarioIndex !== -1 && args[scenarioIndex + 1]) {
    options.scenarioIds = [args[scenarioIndex + 1]];
  }

  const runner = new ValidationRunner();

  try {
    const report = await runner.runAll(options);
    process.exit(report.summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
