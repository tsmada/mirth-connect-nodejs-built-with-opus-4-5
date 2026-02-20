/**
 * ScriptFixtures — Reusable JavaScript script snippets for pipeline lifecycle tests.
 *
 * Each fixture is a raw JavaScript string that will be transpiled by E4X transpiler
 * and executed in a real V8 VM context with full Mirth scope variables.
 */

// ─────────────────────────────────────────────────────
// Test Messages
// ─────────────────────────────────────────────────────

export const XML_ADT_MESSAGE = `<HL7Message>
  <MSH>
    <MSH.9><MSH.9.1>ADT</MSH.9.1><MSH.9.2>A01</MSH.9.2></MSH.9>
    <MSH.10>12345</MSH.10>
  </MSH>
  <PID>
    <PID.3><PID.3.1>MRN001</PID.3.1></PID.3>
    <PID.5><PID.5.1>DOE</PID.5.1><PID.5.2>JOHN</PID.5.2></PID.5>
    <PID.7>19800101</PID.7>
  </PID>
  <EVN>
    <EVN.1>A01</EVN.1>
  </EVN>
</HL7Message>`;

export const JSON_API_MESSAGE = JSON.stringify({
  patient: { mrn: 'MRN001', lastName: 'DOE', firstName: 'JOHN' },
  event: 'A01',
  timestamp: '2026-02-20T00:00:00Z',
});

export const SIMPLE_XML_MESSAGE = '<root><name>test</name><value>42</value></root>';

// ─────────────────────────────────────────────────────
// Filter Rules
// ─────────────────────────────────────────────────────

/** Filter that always accepts (returns true = accepted) */
export const FILTER_ACCEPT: string = 'return true;';

/** Filter that always rejects (returns false = filtered) */
export const FILTER_REJECT: string = 'return false;';

/** Filter that accepts only if message contains "DOE" */
export const FILTER_CONTAINS_DOE: string = `
  var rawMsg = String(msg);
  if (rawMsg.indexOf('DOE') >= 0) {
    return true;
  }
  return false;
`;

/** Filter that rejects messages containing "REJECT_ME" */
export const FILTER_REJECT_IF_MARKER: string = `
  var rawMsg = String(msg);
  if (rawMsg.indexOf('REJECT_ME') >= 0) {
    return false;
  }
  return true;
`;

// ─────────────────────────────────────────────────────
// Transformer Steps
// ─────────────────────────────────────────────────────

/** Transformer that extracts PID.5.1 (last name) and puts to channelMap */
export const TRANSFORMER_EXTRACT_PID: string = `
  // Navigate XML structure and extract PID.5.1
  var xmlMsg = new XML(msg);
  var lastName = '';
  if (xmlMsg.PID && xmlMsg.PID['PID.5'] && xmlMsg.PID['PID.5']['PID.5.1']) {
    lastName = String(xmlMsg.PID['PID.5']['PID.5.1']);
  }
  channelMap.put('patientName', lastName);
`;

/** Transformer that reads channelMap and sets connectorMap */
export const TRANSFORMER_READ_MAPS: string = `
  // Read from channelMap, verify propagation
  var fromPre = channelMap.get('fromPre');
  var fromSource = channelMap.get('fromSource');
  connectorMap.put('destKey', 'destValue');
  connectorMap.put('sawFromPre', String(fromPre));
  connectorMap.put('sawFromSource', String(fromSource));
`;

/** Simple transformer that sets a channelMap key */
export const TRANSFORMER_SET_CHANNEL_MAP: string = `
  channelMap.put('fromSource', 'sourceValue');
`;

/** Transformer that reads global maps and records what it sees */
export const TRANSFORMER_READ_ALL_MAPS: string = `
  var gVal = globalMap.get('globalKey');
  var gcVal = globalChannelMap.get('gcKey');
  var cfgVal = configurationMap.get('cfgKey');
  channelMap.put('sawGlobal', String(gVal));
  channelMap.put('sawGlobalChannel', String(gcVal));
  channelMap.put('sawConfig', String(cfgVal));
  channelMap.put('fromSource', 'sourceValue');
`;

// ─────────────────────────────────────────────────────
// Preprocessor Scripts
// ─────────────────────────────────────────────────────

/** Preprocessor that appends a comment and sets channelMap */
export const PREPROCESSOR_APPEND_COMMENT: string = `
  channelMap.put('fromPre', 'preValue');
  message = message + '<!-- preprocessed -->';
  return message;
`;

/** Preprocessor that returns null (should preserve original message) */
export const PREPROCESSOR_RETURN_NULL: string = `
  return null;
`;

/** Preprocessor that sets channelMap only (no return = preserve original) */
export const PREPROCESSOR_SET_MAP_ONLY: string = `
  channelMap.put('fromPre', 'preValue');
`;

// ─────────────────────────────────────────────────────
// Postprocessor Scripts
// ─────────────────────────────────────────────────────

/** Postprocessor that reads $r and creates a Response */
export const POSTPROCESSOR_READ_RESPONSE: string = `
  var destResponse = responseMap.get('d1');
  globalMap.put('postprocessorRan', 'true');
  if (destResponse) {
    globalMap.put('sawDestResponse', 'true');
  }
  return new Response(SENT, 'Custom ACK');
`;

/** Postprocessor that simply records it ran (uses globalMap since postprocessor
 *  operates on a merged ConnectorMessage — channelMap writes wouldn't propagate
 *  back to the source connector message) */
export const POSTPROCESSOR_RECORD_RAN: string = `
  globalMap.put('postprocessorRan', 'true');
`;

// ─────────────────────────────────────────────────────
// Deploy/Undeploy Scripts
// ─────────────────────────────────────────────────────

/** Deploy script that sets globalMap */
export const DEPLOY_SET_GLOBAL: string = `
  globalMap.put('deployed', 'yes');
  globalMap.put('deployedChannel', channelId);
`;

/** Undeploy script that sets globalMap */
export const UNDEPLOY_SET_GLOBAL: string = `
  globalMap.put('undeployed', 'yes');
`;

// ─────────────────────────────────────────────────────
// Global Scripts
// ─────────────────────────────────────────────────────

/** Global preprocessor that sets a marker */
export const GLOBAL_PREPROCESSOR: string = `
  globalMap.put('globalPreRan', 'true');
  return message;
`;

/** Global postprocessor that reads marker from channel post (via globalMap since
 *  each postprocessor invocation gets a fresh merged ConnectorMessage scope) */
export const GLOBAL_POSTPROCESSOR: string = `
  var channelPostRan = globalMap.get('channelPostRan');
  globalMap.put('globalPostRan', 'true');
  globalMap.put('sawChannelPost', String(channelPostRan));
`;

/** Channel preprocessor that reads global preprocessor marker */
export const CHANNEL_PREPROCESSOR_CHECK_GLOBAL: string = `
  var globalPreRan = globalMap.get('globalPreRan');
  channelMap.put('channelPreRan', 'true');
  channelMap.put('sawGlobalPre', String(globalPreRan));
  return message;
`;

/** Channel postprocessor that sets a marker (runs before global post).
 *  Uses globalMap because postprocessor operates on a merged ConnectorMessage copy —
 *  channelMap writes are ephemeral and invisible to subsequent postprocessor invocations
 *  (each executePostprocessor() call creates a fresh scope from getMergedConnectorMessage()). */
export const CHANNEL_POSTPROCESSOR_SET_MARKER: string = `
  globalMap.put('channelPostRan', 'true');
`;

// ─────────────────────────────────────────────────────
// Response Transformer Scripts
// ─────────────────────────────────────────────────────

/** Response transformer that reads response data and modifies status */
export const RESPONSE_TRANSFORMER_READ_RESPONSE: string = `
  // response and responseStatus/responseStatusMessage are in scope
  channelMap.put('responseTransformerRan', 'true');
  channelMap.put('sawResponseStatus', String(responseStatus));
`;

// ─────────────────────────────────────────────────────
// E4X Scripts
// ─────────────────────────────────────────────────────

/** E4X transformer that creates an XML literal from message content */
export const E4X_TRANSFORMER_XML_LITERAL: string = `
  var xmlMsg = new XML(msg);
  var lastName = '';
  if (xmlMsg.PID && xmlMsg.PID['PID.5'] && xmlMsg.PID['PID.5']['PID.5.1']) {
    lastName = String(xmlMsg.PID['PID.5']['PID.5.1']);
  }
  var ackXml = '<ACK><lastName>' + lastName + '</lastName><status>OK</status></ACK>';
  channelMap.put('ackXml', ackXml);
`;

// ─────────────────────────────────────────────────────
// DestinationSet Scripts
// ─────────────────────────────────────────────────────

/** Transformer that removes destination 2 from the DestinationSet */
export const TRANSFORMER_REMOVE_DEST2: string = `
  // destinationSet is injected into the scope
  destinationSet.remove('Dest 2');
  channelMap.put('removedDest2', 'true');
`;

// ─────────────────────────────────────────────────────
// Map propagation scripts
// ─────────────────────────────────────────────────────

/** Destination transformer that reads all maps and records what it sees */
export const DEST_TRANSFORMER_READ_ALL_MAPS: string = `
  var fromPre = channelMap.get('fromPre');
  var fromSource = channelMap.get('fromSource');
  connectorMap.put('destKey', 'destValue');
  connectorMap.put('sawFromPre', String(fromPre));
  connectorMap.put('sawFromSource', String(fromSource));

  var gVal = globalMap.get('globalKey');
  var gcVal = globalChannelMap.get('gcKey');
  var cfgVal = configurationMap.get('cfgKey');
  connectorMap.put('sawGlobal', String(gVal));
  connectorMap.put('sawGlobalChannel', String(gcVal));
  connectorMap.put('sawConfig', String(cfgVal));
`;

/** Postprocessor that reads merged maps and $r.
 *  Uses globalMap for test-observable writes since channelMap writes on the
 *  merged ConnectorMessage copy don't propagate back to the source. */
export const POSTPROCESSOR_READ_ALL_MAPS: string = `
  var fromPre = channelMap.get('fromPre');
  var fromSource = channelMap.get('fromSource');
  globalMap.put('postSawFromPre', String(fromPre));
  globalMap.put('postSawFromSource', String(fromSource));

  var destResp = responseMap.get('d1');
  globalMap.put('postSawResponse', destResp ? 'true' : 'false');
  globalMap.put('postprocessorRan', 'true');
`;
