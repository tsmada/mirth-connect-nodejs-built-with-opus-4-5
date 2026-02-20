/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/json/JSONBatchAdaptor.java
 *
 * Purpose: Batch adaptor for JSON data type — JavaScript-based splitting only.
 *
 * Key behaviors:
 * - JSON data type has no built-in batch structure, so only JavaScript splitting is supported
 * - Delegates entirely to ScriptBatchAdaptor
 */

import { ScriptBatchAdaptor, ScriptBatchAdaptorFactory } from '../../donkey/message/ScriptBatchAdaptor.js';
import type { BatchAdaptor, BatchAdaptorFactory } from '../../donkey/message/BatchAdaptor.js';
import type { ScriptBatchReader } from '../../donkey/message/ScriptBatchAdaptor.js';

export enum JSONSplitType {
  JavaScript = 'JavaScript',
}

export interface JSONBatchProperties {
  splitType: JSONSplitType;
  batchScript: string;
}

export function getDefaultJSONBatchProperties(): JSONBatchProperties {
  return {
    splitType: JSONSplitType.JavaScript,
    batchScript: '',
  };
}

export { ScriptBatchAdaptor as JSONBatchAdaptor };

export class JSONBatchAdaptorFactory implements BatchAdaptorFactory {
  private scriptFactory: ScriptBatchAdaptorFactory;

  constructor(
    batchScript: (context: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => string | null,
    sourceMap?: Map<string, unknown>
  ) {
    this.scriptFactory = new ScriptBatchAdaptorFactory(batchScript, sourceMap);
  }

  createBatchAdaptor(rawMessage: string): BatchAdaptor {
    return this.scriptFactory.createBatchAdaptor(rawMessage);
  }
}
