/**
 * Code Template Context Set
 *
 * Defines the set of contexts where a code template is available.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/codetemplates/CodeTemplateContextSet.java
 */

import { ContextType } from './ContextType.js';

export class CodeTemplateContextSet extends Set<ContextType> {
  constructor(contextTypes?: ContextType[] | Set<ContextType>) {
    super(contextTypes);
  }

  /**
   * Add contexts and return this set (for chaining)
   */
  addContext(...contextTypes: ContextType[]): CodeTemplateContextSet {
    for (const ct of contextTypes) {
      this.add(ct);
    }
    return this;
  }

  /**
   * Get a context set that includes all contexts
   */
  static getGlobalContextSet(): CodeTemplateContextSet {
    return new CodeTemplateContextSet(Object.values(ContextType) as ContextType[]);
  }

  /**
   * Get a context set for channel-level scripts
   */
  static getChannelContextSet(): CodeTemplateContextSet {
    return CodeTemplateContextSet.getConnectorContextSet().addContext(
      ContextType.CHANNEL_DEPLOY,
      ContextType.CHANNEL_UNDEPLOY,
      ContextType.CHANNEL_PREPROCESSOR,
      ContextType.CHANNEL_POSTPROCESSOR,
      ContextType.CHANNEL_ATTACHMENT,
      ContextType.CHANNEL_BATCH
    );
  }

  /**
   * Get a context set for connector-level scripts
   */
  static getConnectorContextSet(): CodeTemplateContextSet {
    return new CodeTemplateContextSet([
      ContextType.SOURCE_RECEIVER,
      ContextType.SOURCE_FILTER_TRANSFORMER,
      ContextType.DESTINATION_FILTER_TRANSFORMER,
      ContextType.DESTINATION_DISPATCHER,
      ContextType.DESTINATION_RESPONSE_TRANSFORMER,
    ]);
  }

  /**
   * Convert to array for serialization
   */
  toArray(): ContextType[] {
    return Array.from(this);
  }

  /**
   * Create from array (for deserialization)
   */
  static fromArray(contextTypes: ContextType[]): CodeTemplateContextSet {
    return new CodeTemplateContextSet(contextTypes);
  }
}
