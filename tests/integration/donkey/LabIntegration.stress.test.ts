/**
 * Lab Integration Stress Test
 *
 * 13-channel, 30+ step pipeline stress test exercising:
 * - Deep VM routing chains (up to 6 hops)
 * - Heavy filter/transformer execution (15 steps per processor)
 * - Fan-out routing patterns (5 ORM destinations, 3 ORU destinations)
 * - sourceMap propagation across VM channels
 * - Statistics tracking
 * - Error handling and filtered message paths
 *
 * Architecture:
 *   ORM_Inbound -> ORM_Processor (15 steps) -> ORM_Router -> API_CBC | API_CMP | API_UA | API_LIPID | API_DEFAULT
 *   ORU_Inbound -> ORU_Processor (15 steps) -> ORU_Router -> ORU_EMR | ORU_Critical | ORU_Archive
 */

// ===== Mocks (must be before imports) =====

jest.mock('../../../src/db/pool.js', () => ({
  transaction: jest.fn().mockImplementation(async (fn: Function) => {
    const fakeConn = {};
    return fn(fakeConn);
  }),
  withRetry: jest.fn((fn: any) => fn()),
}));

jest.mock('../../../src/db/DonkeyDao.js', () => ({
  insertMessage: jest.fn().mockResolvedValue(undefined),
  insertConnectorMessage: jest.fn().mockResolvedValue(undefined),
  insertContent: jest.fn().mockResolvedValue(undefined),
  storeContent: jest.fn().mockResolvedValue(undefined),
  updateConnectorMessageStatus: jest.fn().mockResolvedValue(undefined),
  updateMessageProcessed: jest.fn().mockResolvedValue(undefined),
  updateStatistics: jest.fn().mockResolvedValue(undefined),
  updateErrors: jest.fn().mockResolvedValue(undefined),
  updateMaps: jest.fn().mockResolvedValue(undefined),
  updateResponseMap: jest.fn().mockResolvedValue(undefined),
  updateSendAttempts: jest.fn().mockResolvedValue(undefined),
  getNextMessageId: jest.fn().mockImplementation(() => Promise.resolve(mockNextMessageId++)),
  channelTablesExist: jest.fn().mockResolvedValue(true),
  getStatistics: jest.fn().mockResolvedValue([]),
  pruneMessageContent: jest.fn().mockResolvedValue(undefined),
  pruneMessageAttachments: jest.fn().mockResolvedValue(undefined),
  insertCustomMetaData: jest.fn().mockResolvedValue(undefined),
  getConnectorMessageStatuses: jest.fn().mockResolvedValue(new Map()),
  getUnfinishedMessagesByServerId: jest.fn().mockResolvedValue([]),
}));

let mockNextMessageId = 1;

// ===== Imports =====

import { Channel } from '../../../src/donkey/channel/Channel';
import { DestinationConnector } from '../../../src/donkey/channel/DestinationConnector';
import { SourceConnector } from '../../../src/donkey/channel/SourceConnector';
import { ConnectorMessage } from '../../../src/model/ConnectorMessage';
import { VmDispatcher, EngineController, DispatchResult } from '../../../src/connectors/vm/VmDispatcher';
import { VmReceiver } from '../../../src/connectors/vm/VmReceiver';
import { RawMessage } from '../../../src/model/RawMessage';
import { Status } from '../../../src/model/Status';
import { FilterRule, TransformerStep, SerializationType } from '../../../src/javascript/runtime/ScriptBuilder';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../src/javascript/runtime/JavaScriptExecutor';
import {
  SOURCE_CHANNEL_ID,
  SOURCE_CHANNEL_IDS,
} from '../../../src/connectors/vm/VmConnectorProperties';
import {
  channelTablesExist, getNextMessageId,
  insertMessage, insertConnectorMessage, insertContent,
  updateConnectorMessageStatus, updateMessageProcessed,
  updateStatistics, getStatistics, getConnectorMessageStatuses,
} from '../../../src/db/DonkeyDao';

// ===== HL7 Message Fixtures =====

const ORM_CBC = [
  'MSH|^~\\&|LAB_SENDER|FACILITY_A|LAB_RECV|FACILITY_B|20240115120000||ORM^O01|MSG001|P|2.3',
  'PID|1||MRN12345^^^HOSP||DOE^JOHN^A||19800101|M|||123 MAIN ST^^ANYTOWN^CA^90210',
  'PV1|1|I|ICU^101^A|E|||1234^SMITH^ROBERT^J|||MED||||ADM|A0||1234^SMITH^ROBERT^J|IP|V001|||||||||||||||||||||||||20240115',
  'IN1|1|BCBS|123456789|BLUE CROSS BLUE SHIELD|PO BOX 1000^^CHICAGO^IL^60601',
  'ORC|NW|ORD001|FIL001||CM||||20240115120000',
  'OBR|1|ORD001|FIL001|85025^CBC WITH DIFF^CPT|||20240115120000||||L||||||1234^SMITH^ROBERT^J',
].join('\r');

const ORM_CMP = [
  'MSH|^~\\&|LAB_SENDER|FACILITY_A|LAB_RECV|FACILITY_B|20240115130000||ORM^O01|MSG002|P|2.3',
  'PID|1||MRN67890^^^HOSP||SMITH^JANE^B||19750315|F|||456 OAK AVE^^RIVERSIDE^CA^92501',
  'PV1|1|O|CLINIC^201^B|R|||5678^JONES^MARIA^L|||INT||||REF|R0||5678^JONES^MARIA^L|OP|V002|||||||||||||||||||||||||20240115',
  'IN1|1|AETNA|987654321|AETNA HEALTH|PO BOX 2000^^HARTFORD^CT^06101',
  'ORC|NW|ORD002|FIL002||CM||||20240115130000',
  'OBR|1|ORD002|FIL002|80053^COMP METABOLIC PANEL^CPT|||20240115130000||||L||||||5678^JONES^MARIA^L',
].join('\r');

const ORM_MULTI = [
  'MSH|^~\\&|LAB_SENDER|FACILITY_A|LAB_RECV|FACILITY_B|20240115140000||ORM^O01|MSG003|P|2.3',
  'PID|1||MRN11111^^^HOSP||GARCIA^CARLOS^M||19901220|M|||789 ELM ST^^SACRAMENTO^CA^95814',
  'PV1|1|I|MED^301^C|U|||2345^WONG^DAVID^K|||SUR||||ADM|A0||2345^WONG^DAVID^K|IP|V003|||||||||||||||||||||||||20240115',
  'IN1|1|UNITED|555666777|UNITED HEALTHCARE|PO BOX 3000^^MINNEAPOLIS^MN^55440',
  'ORC|NW|ORD003|FIL003||CM||||20240115140000',
  'OBR|1|ORD003|FIL003|85025^CBC WITH DIFF^CPT|||20240115140000||||L||||||2345^WONG^DAVID^K',
  'ORC|NW|ORD003B|FIL003B||CM||||20240115140000',
  'OBR|2|ORD003B|FIL003B|81001^URINALYSIS^CPT|||20240115140000||||L||||||2345^WONG^DAVID^K',
].join('\r');

const ORM_UNKNOWN = [
  'MSH|^~\\&|LAB_SENDER|FACILITY_A|LAB_RECV|FACILITY_B|20240115150000||ORM^O01|MSG004|P|2.3',
  'PID|1||MRN22222^^^HOSP||PATEL^PRIYA^R||19850507|F|||321 PINE RD^^FRESNO^CA^93721',
  'PV1|1|E|ER^401^D|E|||3456^LEE^SARAH^N|||EM||||ADM|A0||3456^LEE^SARAH^N|ER|V004|||||||||||||||||||||||||20240115',
  'IN1|1|CIGNA|111222333|CIGNA HEALTHCARE|PO BOX 4000^^BLOOMFIELD^CT^06002',
  'ORC|NW|ORD004|FIL004||CM||||20240115150000',
  'OBR|1|ORD004|FIL004|99999^UNKNOWN TEST^CPT|||20240115150000||||L||||||3456^LEE^SARAH^N',
].join('\r');

const ORM_INVALID = [
  'MSH|^~\\&|LAB_SENDER|FACILITY_A|LAB_RECV|FACILITY_B|20240115160000||ORM^O01|MSG005|P|2.3',
  'ORC|NW|ORD005|FIL005||CM||||20240115160000',
  'OBR|1|ORD005|FIL005|85025^CBC WITH DIFF^CPT|||20240115160000||||L||||||9999^UNKNOWN^DOC',
].join('\r');

const ADT_MESSAGE = [
  'MSH|^~\\&|ADT_SENDER|FACILITY_A|ADT_RECV|FACILITY_B|20240115170000||ADT^A01|MSG006|P|2.3',
  'PID|1||MRN55555^^^HOSP||TAYLOR^ALEX^J||19950812|M|||555 BIRCH LN^^OAKLAND^CA^94601',
  'PV1|1|I|MED^501^E|E|||4567^BROWN^JENNIFER^M|||MED||||ADM|A0||4567^BROWN^JENNIFER^M|IP|V005|||||||||||||||||||||||||20240115',
].join('\r');

const ORU_NORMAL = [
  'MSH|^~\\&|LAB_SENDER|FACILITY_A|LAB_RECV|FACILITY_B|20240115180000||ORU^R01|MSG007|P|2.3',
  'PID|1||MRN33333^^^HOSP||NGUYEN^LINH^T||19880923|F|||888 CEDAR CT^^SAN JOSE^CA^95112',
  'PV1|1|I|ICU^601^F|E|||6789^CHEN^MICHAEL^W|||MED||||ADM|A0||6789^CHEN^MICHAEL^W|IP|V006|||||||||||||||||||||||||20240115',
  'ORC|RE|ORD006|FIL006||CM||||20240115180000',
  'OBR|1|ORD006|FIL006|85025^CBC WITH DIFF^CPT|||20240115170000|||||||20240115180000||6789^CHEN^MICHAEL^W||||||F',
  'OBX|1|NM|6690-2^WBC^LN||7.5|10*3/uL|4.5-11.0|N|||F',
  'OBX|2|NM|718-7^HEMOGLOBIN^LN||14.2|g/dL|12.0-17.5|N|||F',
  'OBX|3|NM|4544-3^HEMATOCRIT^LN||42.1|%|36.0-51.0|N|||F',
].join('\r');

const ORU_CRITICAL = [
  'MSH|^~\\&|LAB_SENDER|FACILITY_A|LAB_RECV|FACILITY_B|20240115190000||ORU^R01|MSG008|P|2.3',
  'PID|1||MRN44444^^^HOSP||KIM^SUNG^H||19700601|M|||999 WALNUT BLVD^^LOS ANGELES^CA^90001',
  'PV1|1|I|ICU^701^G|E|||7890^DAVIS^RACHEL^A|||MED||||ADM|A0||7890^DAVIS^RACHEL^A|IP|V007|||||||||||||||||||||||||20240115',
  'ORC|RE|ORD007|FIL007||CM||||20240115190000',
  'OBR|1|ORD007|FIL007|80053^COMP METABOLIC PANEL^CPT|||20240115180000|||||||20240115190000||7890^DAVIS^RACHEL^A||||||F',
  'OBX|1|NM|2345-7^GLUCOSE^LN||450|mg/dL|70-100|HH|||F',
  'OBX|2|NM|3094-0^BUN^LN||18|mg/dL|7-20|N|||F',
  'OBX|3|NM|2160-0^CREATININE^LN||1.1|mg/dL|0.6-1.2|N|||F',
].join('\r');

// ===== Helper Classes =====

class TestSourceConnector extends SourceConnector {
  constructor() {
    super({ name: 'Test Source', transportName: 'TEST' });
  }
  async start(): Promise<void> { this.running = true; }
  async stop(): Promise<void> { this.running = false; }
}

class TestDestinationConnector extends DestinationConnector {
  public sentMessages: ConnectorMessage[] = [];
  constructor(metaDataId: number, name: string = 'Test Destination') {
    super({ name, metaDataId, transportName: 'TEST' });
  }
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    this.sentMessages.push(connectorMessage);
    connectorMessage.setSendDate(new Date());
  }
  async getResponse(_connectorMessage: ConnectorMessage): Promise<string | null> {
    return null;
  }
}

// ===== Engine Controller and Channel Registry =====

const channels = new Map<string, Channel>();

const engineController: EngineController = {
  async dispatchRawMessage(channelId: string, rawMessage: RawMessage): Promise<DispatchResult | null> {
    const target = channels.get(channelId);
    if (!target) throw new Error(`Channel not deployed: ${channelId}`);
    const message = await target.dispatchRawMessage(
      rawMessage.getRawData(), rawMessage.getSourceMap());
    return { messageId: message.getMessageId() };
  },
};

// ===== Map Variable Constants =====

const MAP_VARIABLES_ORM = ['patientMRN', 'routingKey', 'cptCodes', 'orderingPhysician', 'facilityCode', 'processedAt', 'segmentCount'];
const MAP_VARIABLES_ORU = ['patientMRN', 'hasAbnormal', 'isCritical', 'resultType', 'results', 'deliveryId'];

// ===== Channel Factory Helper =====

function createVmChannel(id: string, name: string, opts: {
  sourceType: 'test' | 'vm';
  sourceFilter?: FilterRule[];
  sourceTransformer?: TransformerStep[];
  destinations: Array<{
    type: 'vm' | 'test';
    name: string;
    metaDataId: number;
    targetChannelId?: string;
    filter?: FilterRule[];
    transformer?: TransformerStep[];
    mapVariables?: string[];
  }>;
}): { channel: Channel; testDests: TestDestinationConnector[] } {
  const channel = new Channel({ id, name, enabled: true });

  if (opts.sourceType === 'vm') {
    channel.setSourceConnector(new VmReceiver({ name: 'Source' }));
  } else {
    channel.setSourceConnector(new TestSourceConnector());
  }

  if (opts.sourceFilter || opts.sourceTransformer) {
    channel.getSourceConnector()!.setFilterTransformer({
      filterRules: opts.sourceFilter,
      transformerSteps: opts.sourceTransformer,
      inboundDataType: SerializationType.RAW,
      outboundDataType: SerializationType.RAW,
    });
  }

  const testDests: TestDestinationConnector[] = [];

  for (const destOpt of opts.destinations) {
    if (destOpt.type === 'vm') {
      const vmDisp = new VmDispatcher({
        metaDataId: destOpt.metaDataId,
        name: destOpt.name,
        properties: {
          channelId: destOpt.targetChannelId!,
          channelTemplate: '${message.encodedData}',
          mapVariables: destOpt.mapVariables || [],
        },
      });
      vmDisp.setEngineController(engineController);

      // IMPORTANT: addDestinationConnector must be called BEFORE setFilterTransformer
      // because setChannel() (called by addDestinationConnector) creates fresh executors,
      // overwriting any previously set filter/transformer scripts.
      channel.addDestinationConnector(vmDisp);

      if (destOpt.filter || destOpt.transformer) {
        vmDisp.setFilterTransformer({
          filterRules: destOpt.filter,
          transformerSteps: destOpt.transformer,
          inboundDataType: SerializationType.RAW,
          outboundDataType: SerializationType.RAW,
        });
      }
    } else {
      const testDest = new TestDestinationConnector(destOpt.metaDataId, destOpt.name);
      channel.addDestinationConnector(testDest);

      if (destOpt.filter || destOpt.transformer) {
        testDest.setFilterTransformer({
          filterRules: destOpt.filter,
          transformerSteps: destOpt.transformer,
          inboundDataType: SerializationType.RAW,
          outboundDataType: SerializationType.RAW,
        });
      }
      testDests.push(testDest);
    }
  }

  channels.set(id, channel);
  return { channel, testDests };
}

// ===== ORM Processor Transformer Steps =====

const ormProcessorSteps: TransformerStep[] = [
  {
    name: 'Validate Segments',
    enabled: true,
    script: `var segments = msg.split('\\r');
var hasMSH = false, hasPID = false, hasORC = false, hasOBR = false;
for (var i = 0; i < segments.length; i++) {
  var seg = segments[i];
  if (seg.indexOf('MSH') === 0) hasMSH = true;
  if (seg.indexOf('PID') === 0) hasPID = true;
  if (seg.indexOf('ORC') === 0) hasORC = true;
  if (seg.indexOf('OBR') === 0) hasOBR = true;
}
if (!hasPID) throw new Error('Missing required PID segment');
if (!hasOBR) throw new Error('Missing required OBR segment');`,
  },
  {
    name: 'Validate ORC Control',
    enabled: true,
    script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('ORC') === 0) {
    var fields = segments[i].split('|');
    $c('orderControl', fields[1] || '');
    break;
  }
}`,
  },
  {
    name: 'Extract Patient MRN',
    enabled: true,
    script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('PID') === 0) {
    var fields = segments[i].split('|');
    var mrn = (fields[3] || '').split('^')[0];
    $c('patientMRN', mrn);
    break;
  }
}`,
  },
  {
    name: 'Extract Demographics',
    enabled: true,
    script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('PID') === 0) {
    var fields = segments[i].split('|');
    $c('patientName', fields[5] || '');
    $c('patientDOB', fields[7] || '');
    $c('patientSex', fields[8] || '');
    break;
  }
}`,
  },
  {
    name: 'Extract Physician',
    enabled: true,
    script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('OBR') === 0) {
    var fields = segments[i].split('|');
    $c('orderingPhysician', fields[16] || 'UNKNOWN');
    break;
  }
}`,
  },
  {
    name: 'Extract CPT Codes',
    enabled: true,
    script: `var segments = msg.split('\\r');
var cptCodes = [];
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('OBR') === 0) {
    var fields = segments[i].split('|');
    var cpt = (fields[4] || '').split('^')[0];
    if (cpt) cptCodes.push(cpt);
  }
}
$c('cptCodes', JSON.stringify(cptCodes));`,
  },
  {
    name: 'Build Routing Key',
    enabled: true,
    script: `var cptCodes = JSON.parse($c('cptCodes') || '[]');
$c('routingKey', cptCodes.length > 0 ? cptCodes[0] : 'UNKNOWN');`,
  },
  {
    name: 'Normalize Dates',
    enabled: true,
    script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('ORC') === 0) {
    var fields = segments[i].split('|');
    var rawDate = fields[9] || '';
    if (rawDate.length >= 8) {
      var iso = rawDate.substring(0,4) + '-' + rawDate.substring(4,6) + '-' + rawDate.substring(6,8);
      $c('orderDate', iso);
    }
    break;
  }
}`,
  },
  {
    name: 'Add Audit Trail',
    enabled: true,
    script: "$c('processedAt', new Date().toISOString());",
  },
  {
    name: 'Validate Insurance',
    enabled: true,
    script: `var segments = msg.split('\\r');
var hasInsurance = false;
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('IN1') === 0) {
    var fields = segments[i].split('|');
    $c('insuranceCompany', fields[4] || 'NONE');
    hasInsurance = true;
    break;
  }
}
$c('hasInsurance', hasInsurance ? 'true' : 'false');`,
  },
  {
    name: 'Duplicate Check',
    enabled: true,
    script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('ORC') === 0) {
    var fields = segments[i].split('|');
    var orderId = fields[2] || '';
    $c('isDuplicate', orderId.indexOf('DUP') >= 0 ? 'true' : 'false');
    break;
  }
}`,
  },
  {
    name: 'Enrich Facility',
    enabled: true,
    script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('MSH') === 0) {
    var fields = segments[i].split('|');
    var facility = fields[3] || 'UNKNOWN';
    var codeMap = { 'FACILITY_A': 'FA001', 'FACILITY_B': 'FB002', 'LAB_SENDER': 'LS003' };
    $c('facilityCode', codeMap[facility] || facility);
    break;
  }
}`,
  },
  {
    name: 'Count Segments',
    enabled: true,
    script: `var segments = msg.split('\\r');
var count = 0;
for (var i = 0; i < segments.length; i++) {
  if (segments[i].length > 0) count++;
}
$c('segmentCount', String(count));`,
  },
  {
    name: 'Verify Integrity',
    enabled: true,
    script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('MSH') === 0) {
    var fields = segments[i].split('|');
    var msgType = fields[8] || '';
    if (msgType.indexOf('ORM') !== 0) throw new Error('Message type corruption detected');
    break;
  }
}`,
  },
  {
    name: 'Final Validation',
    enabled: true,
    script: `var mrn = $c('patientMRN');
var routingKey = $c('routingKey');
if (!mrn || mrn === '') throw new Error('patientMRN not set after processing');
if (!routingKey || routingKey === '' || routingKey === 'UNKNOWN') throw new Error('routingKey not set after processing');`,
  },
];

// ===== ORU Processor Transformer Steps =====

const oruProcessorSteps: TransformerStep[] = [
  {
    name: 'Validate Segments',
    enabled: true,
    script: 'var segments = msg.split("\\r");\nvar hasMSH = false, hasPID = false, hasOBR = false, hasOBX = false;\nfor (var i = 0; i < segments.length; i++) {\n  var seg = segments[i];\n  if (seg.indexOf("MSH") === 0) hasMSH = true;\n  if (seg.indexOf("PID") === 0) hasPID = true;\n  if (seg.indexOf("OBR") === 0) hasOBR = true;\n  if (seg.indexOf("OBX") === 0) hasOBX = true;\n}\nif (!hasPID) throw new Error("Missing required PID segment");\nif (!hasOBX) throw new Error("Missing required OBX segment");',
  },
  {
    name: 'Validate Result Status',
    enabled: true,
    script: 'var segments = msg.split("\\r");\nfor (var i = 0; i < segments.length; i++) {\n  if (segments[i].indexOf("OBR") === 0) {\n    var fields = segments[i].split("|");\n    var status = fields[25] || "F";\n    $c("resultStatus", status);\n    $c("isPreliminary", status === "P" ? "true" : "false");\n    break;\n  }\n}',
  },
  {
    name: 'Extract Patient MRN',
    enabled: true,
    script: 'var segments = msg.split("\\r");\nfor (var i = 0; i < segments.length; i++) {\n  if (segments[i].indexOf("PID") === 0) {\n    var fields = segments[i].split("|");\n    var mrn = (fields[3] || "").split("^")[0];\n    $c("patientMRN", mrn);\n    break;\n  }\n}',
  },
  {
    name: 'Extract Provider',
    enabled: true,
    script: 'var segments = msg.split("\\r");\nfor (var i = 0; i < segments.length; i++) {\n  if (segments[i].indexOf("OBR") === 0) {\n    var fields = segments[i].split("|");\n    $c("orderingProvider", fields[16] || "UNKNOWN");\n    break;\n  }\n}',
  },
  {
    name: 'Extract OBX Results',
    enabled: true,
    script: 'var segments = msg.split("\\r");\nvar results = [];\nfor (var i = 0; i < segments.length; i++) {\n  if (segments[i].indexOf("OBX") === 0) {\n    var fields = segments[i].split("|");\n    results.push({\n      code: (fields[3] || "").split("^")[0],\n      value: fields[5] || "",\n      units: fields[6] || "",\n      range: fields[7] || "",\n      flag: fields[8] || "N"\n    });\n  }\n}\n$c("results", JSON.stringify(results));',
  },
  {
    name: 'Flag Abnormal',
    enabled: true,
    script: 'var results = JSON.parse($c("results") || "[]");\nvar hasAbnormal = false;\nfor (var i = 0; i < results.length; i++) {\n  var flag = results[i].flag || "N";\n  if (flag !== "N" && flag !== "") {\n    hasAbnormal = true;\n    break;\n  }\n}\n$c("hasAbnormal", hasAbnormal ? "true" : "false");',
  },
  {
    name: 'Detect Critical',
    enabled: true,
    script: 'var results = JSON.parse($c("results") || "[]");\nvar isCritical = false;\nfor (var i = 0; i < results.length; i++) {\n  var flag = results[i].flag || "";\n  if (flag === "HH" || flag === "LL") {\n    isCritical = true;\n    break;\n  }\n}\n$c("isCritical", isCritical ? "true" : "false");',
  },
  {
    name: 'Normalize LOINC',
    enabled: true,
    script: 'var results = JSON.parse($c("results") || "[]");\nvar loincCodes = [];\nfor (var i = 0; i < results.length; i++) {\n  if (results[i].code) loincCodes.push(results[i].code);\n}\n$c("loincCodes", JSON.stringify(loincCodes));',
  },
  {
    name: 'Interpretation',
    enabled: true,
    script: 'var results = JSON.parse($c("results") || "[]");\nvar notes = [];\nfor (var i = 0; i < results.length; i++) {\n  var flag = results[i].flag || "N";\n  if (flag === "HH") notes.push(results[i].code + ": CRITICALLY HIGH");\n  else if (flag === "LL") notes.push(results[i].code + ": CRITICALLY LOW");\n  else if (flag === "H") notes.push(results[i].code + ": HIGH");\n  else if (flag === "L") notes.push(results[i].code + ": LOW");\n}\n$c("interpretationNotes", notes.length > 0 ? notes.join("; ") : "All normal");',
  },
  {
    name: 'Validate Ranges',
    enabled: true,
    script: 'var results = JSON.parse($c("results") || "[]");\nvar missingRanges = 0;\nfor (var i = 0; i < results.length; i++) {\n  if (!results[i].range || results[i].range === "") missingRanges++;\n}\n$c("missingRanges", String(missingRanges));',
  },
  {
    name: 'Enrich Facility',
    enabled: true,
    script: 'var segments = msg.split("\\r");\nfor (var i = 0; i < segments.length; i++) {\n  if (segments[i].indexOf("MSH") === 0) {\n    var fields = segments[i].split("|");\n    var facility = fields[3] || "UNKNOWN";\n    var codeMap = { "LAB_SENDER": "LS003", "RESULTS_LAB": "RL004" };\n    $c("facilityCode", codeMap[facility] || facility);\n    break;\n  }\n}',
  },
  {
    name: 'Format for EMR',
    enabled: true,
    script: 'var summary = {\n  mrn: $c("patientMRN") || "",\n  provider: $c("orderingProvider") || "",\n  status: $c("resultStatus") || "",\n  results: JSON.parse($c("results") || "[]"),\n  interpretation: $c("interpretationNotes") || ""\n};\n$c("emrSummary", JSON.stringify(summary));',
  },
  {
    name: 'Set Result Type',
    enabled: true,
    script: 'var isCritical = $c("isCritical");\n$c("resultType", isCritical === "true" ? "critical" : "normal");',
  },
  {
    name: 'Delivery Tracking',
    enabled: true,
    script: '$c("deliveryId", "DLV-" + Date.now());\n$c("deliveryTimestamp", new Date().toISOString());',
  },
  {
    name: 'Final Validation',
    enabled: true,
    script: 'var mrn = $c("patientMRN");\nvar resultType = $c("resultType");\nif (!mrn || mrn === "") throw new Error("patientMRN not set after processing");\nif (!resultType) throw new Error("resultType not set after processing");',
  },
];

// ===== Pipeline Builders =====

async function buildOrmPipeline() {
  // Leaf nodes: 5 API endpoint channels
  const apiCbc = createVmChannel('api-cbc', 'API_CBC', {
    sourceType: 'vm',
    destinations: [{
      type: 'test', name: 'CBC Endpoint', metaDataId: 1,
      transformer: [{ name: 'Mark CBC', script: "$c('apiTarget', 'CBC');", enabled: true }],
    }],
  });

  const apiCmp = createVmChannel('api-cmp', 'API_CMP', {
    sourceType: 'vm',
    destinations: [{
      type: 'test', name: 'CMP Endpoint', metaDataId: 1,
      transformer: [{ name: 'Mark CMP', script: "$c('apiTarget', 'CMP');", enabled: true }],
    }],
  });

  const apiUa = createVmChannel('api-ua', 'API_UA', {
    sourceType: 'vm',
    destinations: [{
      type: 'test', name: 'UA Endpoint', metaDataId: 1,
      transformer: [{ name: 'Mark UA', script: "$c('apiTarget', 'UA');", enabled: true }],
    }],
  });

  const apiLipid = createVmChannel('api-lipid', 'API_LIPID', {
    sourceType: 'vm',
    destinations: [{
      type: 'test', name: 'LIPID Endpoint', metaDataId: 1,
      transformer: [{ name: 'Mark LIPID', script: "$c('apiTarget', 'LIPID');", enabled: true }],
    }],
  });

  const apiDefault = createVmChannel('api-default', 'API_DEFAULT', {
    sourceType: 'vm',
    destinations: [{
      type: 'test', name: 'DEFAULT Endpoint', metaDataId: 1,
      transformer: [{ name: 'Mark DEFAULT', script: "$c('apiTarget', 'DEFAULT');", enabled: true }],
    }],
  });

  // Router: fan-out by CPT code
  const ormRouter = createVmChannel('orm-router', 'ORM_Router', {
    sourceType: 'vm',
    destinations: [
      {
        type: 'vm', name: 'Route to CBC', metaDataId: 1, targetChannelId: 'api-cbc',
        mapVariables: MAP_VARIABLES_ORM,
        filter: [{ name: 'CBC', script: "return ($c('routingKey') || '').toString() === '85025';", operator: 'AND', enabled: true }],
      },
      {
        type: 'vm', name: 'Route to CMP', metaDataId: 2, targetChannelId: 'api-cmp',
        mapVariables: MAP_VARIABLES_ORM,
        filter: [{ name: 'CMP', script: "return ($c('routingKey') || '').toString() === '80053';", operator: 'AND', enabled: true }],
      },
      {
        type: 'vm', name: 'Route to UA', metaDataId: 3, targetChannelId: 'api-ua',
        mapVariables: MAP_VARIABLES_ORM,
        filter: [{ name: 'UA', script: "return ($c('routingKey') || '').toString() === '81001';", operator: 'AND', enabled: true }],
      },
      {
        type: 'vm', name: 'Route to Lipid', metaDataId: 4, targetChannelId: 'api-lipid',
        mapVariables: MAP_VARIABLES_ORM,
        filter: [{ name: 'Lipid', script: "return ($c('routingKey') || '').toString() === '80061';", operator: 'AND', enabled: true }],
      },
      {
        type: 'vm', name: 'Route to Default', metaDataId: 5, targetChannelId: 'api-default',
        mapVariables: MAP_VARIABLES_ORM,
        filter: [{ name: 'Default', script: "return ['85025','80053','81001','80061'].indexOf(($c('routingKey') || '').toString()) === -1;", operator: 'AND', enabled: true }],
      },
    ],
  });

  // Processor: 15 transformer steps
  const ormProcessor = createVmChannel('orm-processor', 'ORM_Processor', {
    sourceType: 'vm',
    sourceTransformer: ormProcessorSteps,
    destinations: [{
      type: 'vm', name: 'To Router', metaDataId: 1, targetChannelId: 'orm-router',
      mapVariables: MAP_VARIABLES_ORM,
    }],
  });

  // Inbound: source filter + extract
  const ormInbound = createVmChannel('orm-inbound', 'ORM_Inbound', {
    sourceType: 'test',
    sourceFilter: [{
      name: 'Accept ORM Only', operator: 'AND', enabled: true,
      script: `var segments = msg.split('\\r');
var msh = null;
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('MSH') === 0) { msh = segments[i]; break; }
}
if (!msh) return false;
var fields = msh.split('|');
var msgType = fields[8] || '';
return msgType.indexOf('ORM') === 0;`,
    }],
    sourceTransformer: [
      {
        name: 'Extract MRN', enabled: true,
        script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('PID') === 0) {
    var fields = segments[i].split('|');
    var mrn = (fields[3] || '').split('^')[0];
    $c('patientMRN', mrn);
    break;
  }
}`,
      },
      {
        name: 'Extract Facility', enabled: true,
        script: `var segments = msg.split('\\r');
for (var i = 0; i < segments.length; i++) {
  if (segments[i].indexOf('MSH') === 0) {
    var fields = segments[i].split('|');
    $c('sendingFacility', fields[3] || 'UNKNOWN');
    break;
  }
}`,
      },
    ],
    destinations: [{
      type: 'vm', name: 'To Processor', metaDataId: 1, targetChannelId: 'orm-processor',
      mapVariables: ['patientMRN', 'sendingFacility'],
    }],
  });

  // Start in dependency order (downstream first)
  await apiCbc.channel.start();
  await apiCmp.channel.start();
  await apiUa.channel.start();
  await apiLipid.channel.start();
  await apiDefault.channel.start();
  await ormRouter.channel.start();
  await ormProcessor.channel.start();
  await ormInbound.channel.start();

  return {
    ormInbound: ormInbound.channel,
    ormProcessor: ormProcessor.channel,
    ormRouter: ormRouter.channel,
    apiCbc: { channel: apiCbc.channel, dest: apiCbc.testDests[0]! },
    apiCmp: { channel: apiCmp.channel, dest: apiCmp.testDests[0]! },
    apiUa: { channel: apiUa.channel, dest: apiUa.testDests[0]! },
    apiLipid: { channel: apiLipid.channel, dest: apiLipid.testDests[0]! },
    apiDefault: { channel: apiDefault.channel, dest: apiDefault.testDests[0]! },
  };
}

async function buildOruPipeline() {
  // Leaf nodes: 3 delivery endpoint channels
  const oruEmr = createVmChannel('oru-emr', 'ORU_EMR', {
    sourceType: 'vm',
    destinations: [{
      type: 'test', name: 'EMR Delivery', metaDataId: 1,
      transformer: [{ name: 'Mark EMR', script: '$c("deliveryTarget", "EMR");', enabled: true }],
    }],
  });

  const oruCritical = createVmChannel('oru-critical', 'ORU_Critical', {
    sourceType: 'vm',
    destinations: [{
      type: 'test', name: 'Critical Alert Delivery', metaDataId: 1,
      transformer: [{ name: 'Mark Critical', script: '$c("deliveryTarget", "CRITICAL_ALERT");', enabled: true }],
    }],
  });

  const oruArchive = createVmChannel('oru-archive', 'ORU_Archive', {
    sourceType: 'vm',
    destinations: [{
      type: 'test', name: 'Archive Delivery', metaDataId: 1,
      transformer: [{ name: 'Mark Archive', script: '$c("deliveryTarget", "ARCHIVE");', enabled: true }],
    }],
  });

  // Router: 3 destinations (EMR=all, Critical=filtered, Archive=all)
  const oruRouter = createVmChannel('oru-router', 'ORU_Router', {
    sourceType: 'vm',
    destinations: [
      {
        type: 'vm', name: 'Route to EMR', metaDataId: 1, targetChannelId: 'oru-emr',
        mapVariables: MAP_VARIABLES_ORU,
      },
      {
        type: 'vm', name: 'Route to Critical', metaDataId: 2, targetChannelId: 'oru-critical',
        mapVariables: MAP_VARIABLES_ORU,
        filter: [{ name: 'Critical Only', script: 'return ($c("isCritical") || "").toString() === "true";', operator: 'AND', enabled: true }],
      },
      {
        type: 'vm', name: 'Route to Archive', metaDataId: 3, targetChannelId: 'oru-archive',
        mapVariables: MAP_VARIABLES_ORU,
      },
    ],
  });

  // Processor: 15 transformer steps
  const oruProcessor = createVmChannel('oru-processor', 'ORU_Processor', {
    sourceType: 'vm',
    sourceTransformer: oruProcessorSteps,
    destinations: [{
      type: 'vm', name: 'To Router', metaDataId: 1, targetChannelId: 'oru-router',
      mapVariables: MAP_VARIABLES_ORU,
    }],
  });

  // Inbound: source filter + extract
  const oruInbound = createVmChannel('oru-inbound', 'ORU_Inbound', {
    sourceType: 'test',
    sourceFilter: [{
      name: 'Accept ORU Only', operator: 'AND', enabled: true,
      script: 'var segments = msg.split("\\r");\nvar msh = null;\nfor (var i = 0; i < segments.length; i++) {\n  if (segments[i].indexOf("MSH") === 0) { msh = segments[i]; break; }\n}\nif (!msh) return false;\nvar fields = msh.split("|");\nvar msgType = fields[8] || "";\nreturn msgType.indexOf("ORU") === 0;',
    }],
    sourceTransformer: [{
      name: 'Extract Result MRN', enabled: true,
      script: 'var segments = msg.split("\\r");\nfor (var i = 0; i < segments.length; i++) {\n  if (segments[i].indexOf("PID") === 0) {\n    var fields = segments[i].split("|");\n    var mrn = (fields[3] || "").split("^")[0];\n    $c("patientMRN", mrn);\n    break;\n  }\n}',
    }],
    destinations: [{
      type: 'vm', name: 'To Processor', metaDataId: 1, targetChannelId: 'oru-processor',
      mapVariables: ['patientMRN'],
    }],
  });

  // Start in dependency order
  await oruEmr.channel.start();
  await oruCritical.channel.start();
  await oruArchive.channel.start();
  await oruRouter.channel.start();
  await oruProcessor.channel.start();
  await oruInbound.channel.start();

  return {
    oruInbound: oruInbound.channel,
    oruProcessor: oruProcessor.channel,
    oruRouter: oruRouter.channel,
    oruEmr: { channel: oruEmr.channel, dest: oruEmr.testDests[0]! },
    oruCritical: { channel: oruCritical.channel, dest: oruCritical.testDests[0]! },
    oruArchive: { channel: oruArchive.channel, dest: oruArchive.testDests[0]! },
  };
}

// ===== Test Suite =====

jest.setTimeout(60000);

describe('Lab Integration Stress Test', () => {
  beforeEach(() => {
    mockNextMessageId = 1;
    jest.clearAllMocks();
    (channelTablesExist as jest.Mock).mockResolvedValue(true);
    (getNextMessageId as jest.Mock).mockImplementation(() => Promise.resolve(mockNextMessageId++));
    (getStatistics as jest.Mock).mockResolvedValue([]);
    (getConnectorMessageStatuses as jest.Mock).mockResolvedValue(new Map());
    (insertMessage as jest.Mock).mockResolvedValue(undefined);
    (insertConnectorMessage as jest.Mock).mockResolvedValue(undefined);
    (insertContent as jest.Mock).mockResolvedValue(undefined);
    (updateConnectorMessageStatus as jest.Mock).mockResolvedValue(undefined);
    (updateMessageProcessed as jest.Mock).mockResolvedValue(undefined);
    (updateStatistics as jest.Mock).mockResolvedValue(undefined);
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
    channels.clear();
  });

  afterEach(async () => {
    for (const channel of channels.values()) {
      try { await channel.stop(); } catch { /* ignore */ }
    }
    channels.clear();
  });

  // ===== ORM Pipeline Tests =====

  describe('ORM Pipeline', () => {
    it('ORM CBC routes to API_CBC only', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ORM_CBC);

      expect(p.apiCbc.dest.sentMessages).toHaveLength(1);
      expect(p.apiCmp.dest.sentMessages).toHaveLength(0);
      expect(p.apiUa.dest.sentMessages).toHaveLength(0);
      expect(p.apiLipid.dest.sentMessages).toHaveLength(0);
      expect(p.apiDefault.dest.sentMessages).toHaveLength(0);
    });

    it('ORM CMP routes to API_CMP only', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ORM_CMP);

      expect(p.apiCbc.dest.sentMessages).toHaveLength(0);
      expect(p.apiCmp.dest.sentMessages).toHaveLength(1);
      expect(p.apiUa.dest.sentMessages).toHaveLength(0);
      expect(p.apiLipid.dest.sentMessages).toHaveLength(0);
      expect(p.apiDefault.dest.sentMessages).toHaveLength(0);
    });

    it('ORM multi-order routes by first OBR CPT', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ORM_MULTI);

      expect(p.apiCbc.dest.sentMessages).toHaveLength(1);
      expect(p.apiCmp.dest.sentMessages).toHaveLength(0);
      expect(p.apiUa.dest.sentMessages).toHaveLength(0);
      expect(p.apiLipid.dest.sentMessages).toHaveLength(0);
      expect(p.apiDefault.dest.sentMessages).toHaveLength(0);
    });

    it('ORM unknown CPT routes to API_DEFAULT', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ORM_UNKNOWN);

      expect(p.apiCbc.dest.sentMessages).toHaveLength(0);
      expect(p.apiCmp.dest.sentMessages).toHaveLength(0);
      expect(p.apiUa.dest.sentMessages).toHaveLength(0);
      expect(p.apiLipid.dest.sentMessages).toHaveLength(0);
      expect(p.apiDefault.dest.sentMessages).toHaveLength(1);
    });

    it('ADT message filtered at ORM_Inbound source filter', async () => {
      const p = await buildOrmPipeline();
      const result = await p.ormInbound.dispatchRawMessage(ADT_MESSAGE);

      expect(p.apiCbc.dest.sentMessages).toHaveLength(0);
      expect(p.apiCmp.dest.sentMessages).toHaveLength(0);
      expect(p.apiUa.dest.sentMessages).toHaveLength(0);
      expect(p.apiLipid.dest.sentMessages).toHaveLength(0);
      expect(p.apiDefault.dest.sentMessages).toHaveLength(0);

      const sourceMsg = result.getConnectorMessage(0);
      expect(sourceMsg).toBeDefined();
      expect(sourceMsg!.getStatus()).toBe(Status.FILTERED);
    });

    it('Invalid ORM (no PID) errors at processor', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ORM_INVALID);

      expect(p.apiCbc.dest.sentMessages).toHaveLength(0);
      expect(p.apiCmp.dest.sentMessages).toHaveLength(0);
      expect(p.apiUa.dest.sentMessages).toHaveLength(0);
      expect(p.apiLipid.dest.sentMessages).toHaveLength(0);
      expect(p.apiDefault.dest.sentMessages).toHaveLength(0);
    });
  });

  // ===== ORU Pipeline Tests =====

  describe('ORU Pipeline', () => {
    it('ORU normal results route to EMR and Archive, not Critical', async () => {
      const p = await buildOruPipeline();
      await p.oruInbound.dispatchRawMessage(ORU_NORMAL);

      expect(p.oruEmr.dest.sentMessages).toHaveLength(1);
      expect(p.oruArchive.dest.sentMessages).toHaveLength(1);
      expect(p.oruCritical.dest.sentMessages).toHaveLength(0);
    });

    it('ORU critical results route to all 3 destinations', async () => {
      const p = await buildOruPipeline();
      await p.oruInbound.dispatchRawMessage(ORU_CRITICAL);

      expect(p.oruEmr.dest.sentMessages).toHaveLength(1);
      expect(p.oruArchive.dest.sentMessages).toHaveLength(1);
      expect(p.oruCritical.dest.sentMessages).toHaveLength(1);
    });

    it('ADT message filtered at ORU_Inbound source filter', async () => {
      const p = await buildOruPipeline();
      const result = await p.oruInbound.dispatchRawMessage(ADT_MESSAGE);

      expect(p.oruEmr.dest.sentMessages).toHaveLength(0);
      expect(p.oruArchive.dest.sentMessages).toHaveLength(0);
      expect(p.oruCritical.dest.sentMessages).toHaveLength(0);

      const sourceMsg = result.getConnectorMessage(0);
      expect(sourceMsg?.getStatus()).toBe(Status.FILTERED);
    });
  });

  // ===== Data Integrity Tests =====

  describe('Data Integrity', () => {
    it('channelMap data preserved through full ORM pipeline', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ORM_CBC);

      expect(p.apiCbc.dest.sentMessages).toHaveLength(1);
      const msg = p.apiCbc.dest.sentMessages[0]!;
      // The sourceMap should contain values propagated via mapVariables
      const sourceMap = msg.getSourceMap();
      expect(sourceMap.get('patientMRN')).toBe('MRN12345');
      expect(sourceMap.get('routingKey')).toBe('85025');
      expect(sourceMap.get('facilityCode')).toBe('FA001');
      expect(sourceMap.get('processedAt')).toBeDefined();
    });

    it('channelMap data preserved through full ORU pipeline', async () => {
      const p = await buildOruPipeline();
      await p.oruInbound.dispatchRawMessage(ORU_CRITICAL);

      expect(p.oruCritical.dest.sentMessages).toHaveLength(1);
      const msg = p.oruCritical.dest.sentMessages[0]!;
      const sourceMap = msg.getSourceMap();
      expect(sourceMap.get('isCritical')).toBe('true');
      expect(sourceMap.get('patientMRN')).toBe('MRN44444');
      expect(sourceMap.get('resultType')).toBe('critical');
    });

    it('sourceMap chain tracks ORM journey', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ORM_CBC);

      const msg = p.apiCbc.dest.sentMessages[0]!;
      const sourceMap = msg.getSourceMap();

      // The message should have source channel tracking
      expect(sourceMap.has(SOURCE_CHANNEL_ID)).toBe(true);
      // SOURCE_CHANNEL_IDS should contain the chain of channels traversed
      const chainIds = sourceMap.get(SOURCE_CHANNEL_IDS) as string[] | undefined;
      if (chainIds) {
        expect(chainIds.length).toBeGreaterThan(0);
      }
    });
  });

  // ===== Statistics Tests =====

  describe('Statistics', () => {
    it('ORM pipeline stats after single message', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ORM_CBC);

      // ORM_Inbound should have received 1 message and sent at least 1
      const inboundStats = p.ormInbound.getStatistics();
      expect(inboundStats.received).toBe(1);
      expect(inboundStats.sent).toBeGreaterThanOrEqual(1);

      // API_CBC should have received and sent 1 message
      const cbcStats = p.apiCbc.channel.getStatistics();
      expect(cbcStats.received).toBe(1);
      expect(cbcStats.sent).toBeGreaterThanOrEqual(1);
    });

    it('Filtered message increments filtered counter', async () => {
      const p = await buildOrmPipeline();
      await p.ormInbound.dispatchRawMessage(ADT_MESSAGE);

      const stats = p.ormInbound.getStatistics();
      expect(stats.received).toBe(1);
      expect(stats.filtered).toBe(1);
      expect(stats.sent).toBe(0);
    });
  });

  // ===== Throughput Tests =====

  describe('Throughput', () => {
    it('Full ORM pipeline completes in < 5000ms', async () => {
      const p = await buildOrmPipeline();

      const start = performance.now();
      await p.ormInbound.dispatchRawMessage(ORM_CBC);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5000);
      expect(p.apiCbc.dest.sentMessages).toHaveLength(1);
    });

    it('Sequential 4-message ORM batch routes correctly', async () => {
      const p = await buildOrmPipeline();

      await p.ormInbound.dispatchRawMessage(ORM_CBC);
      await p.ormInbound.dispatchRawMessage(ORM_CMP);
      await p.ormInbound.dispatchRawMessage(ORM_UNKNOWN);
      await p.ormInbound.dispatchRawMessage(ORM_MULTI);

      // Each message should route to its correct destination
      expect(p.apiCbc.dest.sentMessages).toHaveLength(2); // CBC + MULTI (first OBR = 85025)
      expect(p.apiCmp.dest.sentMessages).toHaveLength(1);
      expect(p.apiDefault.dest.sentMessages).toHaveLength(1);

      // Inbound stats should show 4 messages received
      const stats = p.ormInbound.getStatistics();
      expect(stats.received).toBe(4);
    });
  });
});
