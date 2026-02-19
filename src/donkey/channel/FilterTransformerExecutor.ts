/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/FilterTransformerExecutor.java
 *
 * Purpose: Execute filter and transformer scripts for connectors
 *
 * Key behaviors to replicate:
 * - Compile and cache scripts
 * - Execute with proper scope (msg, tmp, connectorMessage, maps)
 * - Return filter/transform results
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { ContentType } from '../../model/ContentType.js';
import {
  JavaScriptExecutor,
  getDefaultExecutor,
} from '../../javascript/runtime/JavaScriptExecutor.js';
import {
  FilterRule,
  TransformerStep,
  SerializationType,
} from '../../javascript/runtime/ScriptBuilder.js';
import { ScriptContext } from '../../javascript/runtime/ScopeBuilder.js';
import { SerializerFactory } from '../../util/SerializerFactory.js';

export interface FilterTransformerResult {
  filtered: boolean;
  transformedData?: string;
  transformedDataType?: string;
  error?: string;
}

export interface FilterTransformerScripts {
  filterRules?: FilterRule[];
  transformerSteps?: TransformerStep[];
  inboundDataType?: SerializationType;
  outboundDataType?: SerializationType;
  inboundDataTypeName?: string;
  outboundDataTypeName?: string;
  template?: string;
}

export class FilterTransformerExecutor {
  private filterRules: FilterRule[] = [];
  private transformerSteps: TransformerStep[] = [];
  private inboundDataType: SerializationType = SerializationType.RAW;
  private outboundDataType: SerializationType = SerializationType.RAW;
  private inboundDataTypeName: string = 'RAW';
  private template: string = '';
  private executor: JavaScriptExecutor;
  private context: ScriptContext;

  constructor(context: ScriptContext, scripts: FilterTransformerScripts = {}) {
    this.context = context;
    this.executor = getDefaultExecutor();
    this.setScripts(scripts);
  }

  setScripts(scripts: FilterTransformerScripts): void {
    this.filterRules = scripts.filterRules ?? [];
    this.transformerSteps = scripts.transformerSteps ?? [];
    this.inboundDataType = scripts.inboundDataType ?? SerializationType.RAW;
    this.outboundDataType = scripts.outboundDataType ?? SerializationType.RAW;
    this.inboundDataTypeName = scripts.inboundDataTypeName ?? 'RAW';
    this.template = scripts.template ?? '';
  }

  getInboundDataType(): string {
    return this.inboundDataType;
  }

  setExecutor(executor: JavaScriptExecutor): void {
    this.executor = executor;
  }

  /**
   * Execute filter rules
   * @returns true if message should be filtered (rejected), false to continue processing
   */
  async executeFilter(connectorMessage: ConnectorMessage): Promise<boolean> {
    if (this.filterRules.length === 0) {
      return false; // No filter rules, accept all
    }

    // Get the raw content for filtering
    const rawContent = this.getRawContent(connectorMessage);

    try {
      const result = this.executor.executeFilter(
        this.filterRules,
        connectorMessage,
        rawContent,
        this.inboundDataType,
        this.context
      );

      // Mirth filter: accepted = true means continue, accepted = false means filtered
      return !result.accepted;
    } catch (error) {
      // Filter errors should cause message to error, not filter
      throw new Error(`Filter execution error: ${String(error)}`);
    }
  }

  /**
   * Execute transformer steps
   * @returns transformed message data
   */
  async executeTransformer(connectorMessage: ConnectorMessage): Promise<FilterTransformerResult> {
    // Get the raw content for transformation
    const rawContent = this.getRawContent(connectorMessage);

    if (this.transformerSteps.length === 0) {
      // No transformer, return raw content
      const content =
        connectorMessage.getContent(ContentType.PROCESSED_RAW) ?? connectorMessage.getRawContent();

      return {
        filtered: false,
        transformedData: content?.content ?? rawContent,
        transformedDataType: content?.dataType ?? 'RAW',
      };
    }

    try {
      const result = this.executor.executeTransformer(
        this.transformerSteps,
        connectorMessage,
        rawContent,
        this.template,
        this.inboundDataType,
        this.outboundDataType,
        this.context
      );

      if (!result.transformed) {
        return {
          filtered: false,
          error: result.error?.message,
        };
      }

      // Get transformed data from the connectorMessage (transformer may have set it)
      const transformedData = connectorMessage.getTransformedData() ?? rawContent;

      return {
        filtered: false,
        transformedData,
        transformedDataType: this.outboundDataType,
      };
    } catch (error) {
      return {
        filtered: false,
        error: String(error),
      };
    }
  }

  /**
   * Execute both filter and transformer in sequence
   */
  async execute(connectorMessage: ConnectorMessage): Promise<FilterTransformerResult> {
    // Get the raw content
    const rawContent = this.getRawContent(connectorMessage);

    // Use the combined filter/transformer execution for efficiency
    const result = this.executor.executeFilterTransformer(
      this.filterRules,
      this.transformerSteps,
      connectorMessage,
      rawContent,
      this.template,
      this.inboundDataType,
      this.outboundDataType,
      this.context
    );

    if (!result.success) {
      return {
        filtered: false,
        error: result.error?.message,
      };
    }

    // result.result is true if filter passed and transformer ran, false if filtered
    if (result.result === false) {
      return { filtered: true };
    }

    // Get transformed data from the connectorMessage
    const transformedData = connectorMessage.getTransformedData() ?? rawContent;

    return {
      filtered: false,
      transformedData,
      transformedDataType: this.outboundDataType,
    };
  }

  /**
   * Process connector message (combined filter + transform with status updates)
   */
  async processConnectorMessage(
    connectorMessage: ConnectorMessage
  ): Promise<FilterTransformerResult> {
    const result = await this.execute(connectorMessage);

    // Update connector message with transformed content
    if (!result.filtered && result.transformedData) {
      connectorMessage.setTransformedData(
        result.transformedData,
        result.transformedDataType ?? 'XML'
      );
    }

    return result;
  }

  /**
   * Get content from connector message, serialized for the inbound data type.
   *
   * Java Mirth: FilterTransformerExecutor.doFilterTransformerForEntry() serializes
   * the raw content using inbound.getSerializer().toXML() BEFORE the filter/transformer
   * script runs. This is critical for data types like HL7V2 where the raw format (ER7)
   * must be converted to XML for E4X-style navigation (msg['MSH']['MSH.9']).
   */
  private getRawContent(connectorMessage: ConnectorMessage): string {
    // Prefer processed raw, fall back to raw
    const processedRaw = connectorMessage.getProcessedRawData();
    const rawContent = processedRaw || connectorMessage.getRawData() || '';

    // Serialize to XML if the inbound data type requires it
    // (e.g., HL7V2 ER7 → XML, NCPDP → XML, EDI → XML, Delimited → XML)
    if (this.inboundDataType === SerializationType.XML && this.inboundDataTypeName) {
      const serializer = SerializerFactory.getSerializer(this.inboundDataTypeName);
      if (serializer) {
        const xml = serializer.toXML(rawContent);
        if (xml) return xml;
      }
    }

    return rawContent;
  }
}
