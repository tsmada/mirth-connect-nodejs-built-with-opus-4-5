/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/ncpdp/NCPDPBatchAdaptor.java
 *
 * Purpose: Batch adaptor for NCPDP data type — JavaScript-based splitting only.
 *
 * Key behaviors:
 * - NCPDP data type has no built-in batch structure, so only JavaScript splitting is supported
 * - Delegates entirely to ScriptBatchAdaptor
 */

import { ScriptBatchAdaptor, ScriptBatchAdaptorFactory } from '../../donkey/message/ScriptBatchAdaptor.js';
import type { BatchAdaptor, BatchAdaptorFactory } from '../../donkey/message/BatchAdaptor.js';
import type { ScriptBatchReader } from '../../donkey/message/ScriptBatchAdaptor.js';

export enum NCPDPSplitType {
  JavaScript = 'JavaScript',
}

export interface NCPDPBatchProperties {
  splitType: NCPDPSplitType;
  batchScript: string;
}

export function getDefaultNCPDPBatchProperties(): NCPDPBatchProperties {
  return {
    splitType: NCPDPSplitType.JavaScript,
    batchScript: '',
  };
}

export { ScriptBatchAdaptor as NCPDPBatchAdaptor };

export class NCPDPBatchAdaptorFactory implements BatchAdaptorFactory {
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
