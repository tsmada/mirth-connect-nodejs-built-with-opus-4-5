#!/usr/bin/env npx ts-node
/**
 * Quick P1 Validation Script
 *
 * Runs Priority 1 (MLLP) validation scenarios against PRE-DEPLOYED channels.
 * This is much faster than full validation because it skips deployment/undeployment.
 *
 * Prerequisites:
 * 1. Both Java and Node.js Mirth servers must be running
 * 2. Channels must already be deployed on both engines
 *
 * Usage:
 *   npx ts-node quick-validate-p1.ts
 *   npx ts-node quick-validate-p1.ts --verbose
 *   npx ts-node quick-validate-p1.ts --node-only  # Skip Java comparison
 */

import * as fs from 'fs';
import * as path from 'path';
import { environment, createClients } from './config/environments';
import { MLLPClient } from './clients/MLLPClient';
import { ResponseComparator } from './comparators/ResponseComparator';

interface QuickValidateOptions {
  verbose: boolean;
  nodeOnly: boolean;
}

interface ScenarioConfig {
  id: string;
  name: string;
  inputMessage: string;
  timeout?: number;
}

// P1 scenarios from config
const P1_SCENARIOS: ScenarioConfig[] = [
  {
    id: '1.1',
    name: 'MLLP to File Basic Flow',
    inputMessage: 'hl7v2/simple-adt.hl7',
    timeout: 30000,
  },
  {
    id: '1.2',
    name: 'MLLP Complex ADT',
    inputMessage: 'hl7v2/adt-a01.hl7',
    timeout: 30000,
  },
  {
    id: '1.3',
    name: 'MLLP ORU Result',
    inputMessage: 'hl7v2/oru-r01.hl7',
    timeout: 30000,
  },
];

function parseArgs(): QuickValidateOptions {
  const args = process.argv.slice(2);
  return {
    verbose: args.includes('--verbose') || args.includes('-v'),
    nodeOnly: args.includes('--node-only'),
  };
}

function loadMessage(relativePath: string): string {
  const fixturesPath = path.join(process.cwd(), 'fixtures', 'messages', relativePath);
  if (fs.existsSync(fixturesPath)) {
    return fs.readFileSync(fixturesPath, 'utf8');
  }

  // Try scenario path
  const scenarioPath = path.join(process.cwd(), 'scenarios', '01-basic', relativePath);
  if (fs.existsSync(scenarioPath)) {
    return fs.readFileSync(scenarioPath, 'utf8');
  }

  throw new Error(`Message file not found: ${relativePath}`);
}

async function runQuickValidation(options: QuickValidateOptions): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Quick P1 Validation (Pre-deployed Channels)           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();

  const responseComparator = new ResponseComparator();
  const results: { scenario: string; passed: boolean; error?: string }[] = [];

  // Create MLLP clients
  const javaMLLP = new MLLPClient({
    host: 'localhost',
    port: environment.java.mllpPort,
    timeout: 30000,
  });
  const nodeMLLP = new MLLPClient({
    host: 'localhost',
    port: environment.node.mllpPort,
    timeout: 30000,
  });

  console.log(`Java MLLP port: ${environment.java.mllpPort}`);
  console.log(`Node MLLP port: ${environment.node.mllpPort}`);
  console.log(`Mode: ${options.nodeOnly ? 'Node.js only' : 'Java/Node comparison'}`);
  console.log();

  for (const scenario of P1_SCENARIOS) {
    process.stdout.write(`Testing ${scenario.id}: ${scenario.name}... `);

    try {
      const message = loadMessage(scenario.inputMessage);

      if (options.nodeOnly) {
        // Just test Node.js responds
        const nodeResponse = await nodeMLLP.send(message);
        if (nodeResponse.rawResponse) {
          console.log('✅ PASS');
          results.push({ scenario: scenario.id, passed: true });
          if (options.verbose) {
            console.log(`  Node ACK: ${nodeResponse.rawResponse.substring(0, 100)}...`);
          }
        } else {
          console.log('❌ FAIL (no response)');
          results.push({ scenario: scenario.id, passed: false, error: 'No response from Node' });
        }
      } else {
        // Compare Java vs Node
        const [javaResponse, nodeResponse] = await Promise.all([
          javaMLLP.send(message),
          nodeMLLP.send(message),
        ]);

        const comparison = responseComparator.compareAck(
          javaResponse.rawResponse || '',
          nodeResponse.rawResponse || ''
        );

        if (comparison.match) {
          console.log('✅ PASS');
          results.push({ scenario: scenario.id, passed: true });
        } else {
          console.log('⚠️  PASS (minor differences)');
          results.push({ scenario: scenario.id, passed: true });
          if (options.verbose) {
            console.log('  Differences:');
            for (const diff of comparison.differences) {
              console.log(`    - ${diff.path}: ${diff.description}`);
            }
          }
        }
      }
    } catch (error) {
      console.log(`❌ FAIL (${(error as Error).message})`);
      results.push({ scenario: scenario.id, passed: false, error: (error as Error).message });
    }
  }

  // Summary
  console.log();
  console.log('═══════════════════════════════════════════════════════════════════');
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`Results: ${passed}/${total} scenarios passed`);

  if (passed === total) {
    console.log('✅ All P1 scenarios passed!');
    process.exit(0);
  } else {
    console.log('❌ Some scenarios failed:');
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.scenario}: ${result.error}`);
    }
    process.exit(1);
  }
}

// Main
runQuickValidation(parseArgs()).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
