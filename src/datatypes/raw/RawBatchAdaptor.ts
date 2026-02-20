/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/raw/RawBatchAdaptor.java
 *
 * Purpose: Batch adaptor for Raw data type — JavaScript-based splitting only.
 *
 * Key behaviors:
 * - Raw data type has no built-in batch structure, so only JavaScript splitting is supported
 * - Delegates entirely to ScriptBatchAdaptor
 */

import { ScriptBatchAdaptor, ScriptBatchAdaptorFactory } from '../../donkey/message/ScriptBatchAdaptor.js';
import type { BatchAdaptor, BatchAdaptorFactory } from '../../donkey/message/BatchAdaptor.js';
import type { ScriptBatchReader } from '../../donkey/message/ScriptBatchAdaptor.js';

export enum RawSplitType {
  JavaScript = 'JavaScript',
}

export interface RawBatchProperties {
  splitType: RawSplitType;
  batchScript: string;
}

export function getDefaultRawBatchProperties(): RawBatchProperties {
  return {
    splitType: RawSplitType.JavaScript,
    batchScript: '',
  };
}

export { ScriptBatchAdaptor as RawBatchAdaptor };

export class RawBatchAdaptorFactory implements BatchAdaptorFactory {
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
