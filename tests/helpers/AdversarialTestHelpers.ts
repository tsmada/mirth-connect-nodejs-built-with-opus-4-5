/**
 * Adversarial test helpers for running E4X-transpiled scripts through the
 * full transpiler -> scope -> VM pipeline, matching production execution.
 */

import * as vm from 'node:vm';
import { transpileE4X } from '../../src/javascript/e4x/E4XTranspiler.js';
import { buildBasicScope, buildFilterTransformerScope } from '../../src/javascript/runtime/ScopeBuilder.js';
import { ConnectorMessage } from '../../src/model/ConnectorMessage.js';
import { Status } from '../../src/model/Status.js';

/**
 * Transpile E4X script, build a basic VM scope, and execute.
 * Returns the VM context (scope) after execution for inspection.
 */
export function transpileAndRun(script: string, extraScope?: Record<string, unknown>): Record<string, unknown> {
  const transpiled = transpileE4X(script);
  const scope = buildBasicScope();

  if (extraScope) {
    Object.assign(scope, extraScope);
  }

  const context = vm.createContext(scope);
  const compiled = new vm.Script(transpiled);
  compiled.runInContext(context, { timeout: 5000 });

  return context;
}

/**
 * Create a minimal ConnectorMessage for testing.
 * Provides all required fields with sensible defaults.
 */
export function createTestConnectorMessage(overrides?: Partial<{
  messageId: number;
  metaDataId: number;
  channelId: string;
  channelName: string;
  connectorName: string;
  serverId: string;
  status: Status;
}>): ConnectorMessage {
  return new ConnectorMessage({
    messageId: overrides?.messageId ?? 1,
    metaDataId: overrides?.metaDataId ?? 0,
    channelId: overrides?.channelId ?? 'test-channel-id',
    channelName: overrides?.channelName ?? 'Test Channel',
    connectorName: overrides?.connectorName ?? 'Source',
    serverId: overrides?.serverId ?? 'test-server',
    receivedDate: new Date(),
    status: overrides?.status ?? Status.RECEIVED,
  });
}

/**
 * Build a filter/transformer scope with test defaults and execute a script.
 * Returns the VM context after execution.
 */
export function runInFilterTransformerScope(
  script: string,
  rawContent: string,
  options?: {
    channelId?: string;
    channelName?: string;
    template?: string;
    phase?: string;
  }
): Record<string, unknown> {
  const transpiled = transpileE4X(script);

  const connectorMessage = createTestConnectorMessage({
    channelId: options?.channelId ?? 'test-channel-id',
    channelName: options?.channelName ?? 'Test Channel',
  });

  const scope = buildFilterTransformerScope(
    {
      channelId: options?.channelId ?? 'test-channel-id',
      channelName: options?.channelName ?? 'Test Channel',
    },
    connectorMessage,
    rawContent,
    options?.template ?? '',
    options?.phase ?? 'each'
  );

  const context = vm.createContext(scope);
  const compiled = new vm.Script(transpiled);
  compiled.runInContext(context, { timeout: 5000 });

  return context;
}

/**
 * Sample HL7v2 XML used across multiple adversarial tests.
 */
export const SAMPLE_HL7_XML = `<HL7Message>
  <MSH>
    <MSH.1>|</MSH.1>
    <MSH.2>^~\\&amp;</MSH.2>
    <MSH.9>
      <MSH.9.1>ADT</MSH.9.1>
      <MSH.9.2>A01</MSH.9.2>
    </MSH.9>
  </MSH>
  <PID>
    <PID.3>
      <PID.3.1>12345</PID.3.1>
    </PID.3>
    <PID.5>
      <PID.5.1>DOE</PID.5.1>
      <PID.5.2>JOHN</PID.5.2>
    </PID.5>
  </PID>
  <PV1>
    <PV1.2>I</PV1.2>
    <PV1.3>
      <PV1.3.1>WARD-A</PV1.3.1>
    </PV1.3>
  </PV1>
  <OBX>
    <OBX.3>WBC</OBX.3>
    <OBX.5>7.5</OBX.5>
  </OBX>
  <OBX>
    <OBX.3>RBC</OBX.3>
    <OBX.5>4.2</OBX.5>
  </OBX>
  <OBX>
    <OBX.3>HGB</OBX.3>
    <OBX.5>14.0</OBX.5>
  </OBX>
</HL7Message>`;
