/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/Channel.java
 *
 * Purpose: Channel configuration model (distinct from runtime Channel)
 *
 * Key behaviors to replicate:
 * - Stores channel configuration as loaded from database
 * - Serializes to/from XML for Mirth compatibility
 * - Contains source connector and destination connectors config
 */

import type { FilterData } from './Filter.js';
import type { TransformerData } from './Transformer.js';

export interface ConnectorProperties {
  name: string;
  transportName: string;
  enabled?: boolean;
  waitForPrevious?: boolean;
  properties?: Record<string, unknown>;
}

export interface SourceConnectorProperties extends ConnectorProperties {
  filter?: FilterData;
  transformer?: TransformerData;
  responseTransformer?: TransformerData;
}

export interface DestinationConnectorProperties extends ConnectorProperties {
  metaDataId: number;
  filter?: FilterData;
  transformer?: TransformerData;
  responseTransformer?: TransformerData;
  queueEnabled?: boolean;
  sendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  regenerateTemplate?: boolean;
}

export interface ChannelPropertiesData {
  id: string;
  name: string;
  description?: string;
  revision?: number;
  enabled?: boolean;

  // Source connector
  sourceConnector?: SourceConnectorProperties;

  // Destination connectors
  destinationConnectors?: DestinationConnectorProperties[];

  // Scripts
  preprocessingScript?: string;
  postprocessingScript?: string;
  deployScript?: string;
  undeployScript?: string;

  // Properties
  properties?: Record<string, unknown>;

  // Export/metadata
  exportData?: {
    metadata?: Record<string, string>;
    serverConfiguration?: Record<string, unknown>;
  };
}

export class ChannelProperties {
  private id: string;
  private name: string;
  private description: string;
  private revision: number;
  private enabled: boolean;

  private sourceConnector?: SourceConnectorProperties;
  private destinationConnectors: DestinationConnectorProperties[] = [];

  private preprocessingScript: string;
  private postprocessingScript: string;
  private deployScript: string;
  private undeployScript: string;

  private properties: Record<string, unknown>;

  constructor(data: ChannelPropertiesData) {
    this.id = data.id;
    this.name = data.name;
    this.description = data.description ?? '';
    this.revision = data.revision ?? 0;
    this.enabled = data.enabled ?? true;

    this.sourceConnector = data.sourceConnector;
    this.destinationConnectors = data.destinationConnectors ?? [];

    this.preprocessingScript = data.preprocessingScript ?? '';
    this.postprocessingScript = data.postprocessingScript ?? '';
    this.deployScript = data.deployScript ?? '';
    this.undeployScript = data.undeployScript ?? '';

    this.properties = data.properties ?? {};
  }

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }

  getDescription(): string {
    return this.description;
  }

  setDescription(description: string): void {
    this.description = description;
  }

  getRevision(): number {
    return this.revision;
  }

  setRevision(revision: number): void {
    this.revision = revision;
  }

  incrementRevision(): void {
    this.revision++;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getSourceConnector(): SourceConnectorProperties | undefined {
    return this.sourceConnector;
  }

  setSourceConnector(connector: SourceConnectorProperties): void {
    this.sourceConnector = connector;
  }

  getDestinationConnectors(): DestinationConnectorProperties[] {
    return this.destinationConnectors;
  }

  setDestinationConnectors(connectors: DestinationConnectorProperties[]): void {
    this.destinationConnectors = connectors;
  }

  addDestinationConnector(connector: DestinationConnectorProperties): void {
    this.destinationConnectors.push(connector);
  }

  getDestinationConnector(metaDataId: number): DestinationConnectorProperties | undefined {
    return this.destinationConnectors.find((d) => d.metaDataId === metaDataId);
  }

  getPreprocessingScript(): string {
    return this.preprocessingScript;
  }

  setPreprocessingScript(script: string): void {
    this.preprocessingScript = script;
  }

  getPostprocessingScript(): string {
    return this.postprocessingScript;
  }

  setPostprocessingScript(script: string): void {
    this.postprocessingScript = script;
  }

  getDeployScript(): string {
    return this.deployScript;
  }

  setDeployScript(script: string): void {
    this.deployScript = script;
  }

  getUndeployScript(): string {
    return this.undeployScript;
  }

  setUndeployScript(script: string): void {
    this.undeployScript = script;
  }

  getProperties(): Record<string, unknown> {
    return this.properties;
  }

  getProperty(key: string): unknown {
    return this.properties[key];
  }

  setProperty(key: string, value: unknown): void {
    this.properties[key] = value;
  }

  /**
   * Serialize to plain object for storage/API
   */
  toJSON(): ChannelPropertiesData {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      revision: this.revision,
      enabled: this.enabled,
      sourceConnector: this.sourceConnector,
      destinationConnectors: this.destinationConnectors,
      preprocessingScript: this.preprocessingScript,
      postprocessingScript: this.postprocessingScript,
      deployScript: this.deployScript,
      undeployScript: this.undeployScript,
      properties: this.properties,
    };
  }
}
