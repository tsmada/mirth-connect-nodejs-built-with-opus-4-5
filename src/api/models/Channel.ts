/**
 * Channel model for API
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/Channel.java
 */

import { DeployedState } from './DashboardStatus.js';

export interface Channel {
  id: string;
  name: string;
  description?: string;
  revision: number;
  enabled: boolean;
  sourceConnector: Connector;
  destinationConnectors: Connector[];
  preprocessingScript?: string;
  postprocessingScript?: string;
  deployScript?: string;
  undeployScript?: string;
  properties: ChannelProperties;
  exportData?: ExportData;
  codeTemplateLibraries?: CodeTemplateLibrary[];
}

export interface Connector {
  metaDataId: number;
  name: string;
  enabled: boolean;
  transportName: string;
  properties: Record<string, unknown>;
  filter?: FilterConfig;
  transformer?: TransformerConfig;
  responseTransformer?: TransformerConfig;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
}

export interface FilterConfig {
  rules: FilterRule[];
}

export interface FilterRule {
  name: string;
  sequenceNumber: number;
  enabled: boolean;
  operator: 'AND' | 'OR' | 'NONE';
  type: string;
  script?: string;
}

export interface TransformerConfig {
  steps: TransformerStep[];
  inboundDataType?: string;
  outboundDataType?: string;
  inboundProperties?: Record<string, unknown>;
  outboundProperties?: Record<string, unknown>;
}

export interface TransformerStep {
  name: string;
  sequenceNumber: number;
  enabled: boolean;
  type: string;
  script?: string;
  data?: Record<string, unknown>;
}

export interface ChannelProperties {
  clearGlobalChannelMap?: boolean;
  messageStorageMode?: string;
  encryptData?: boolean;
  removeContentOnCompletion?: boolean;
  removeOnlyFilteredOnCompletion?: boolean;
  removeAttachmentsOnCompletion?: boolean;
  initialState?: DeployedState;
  storeAttachments?: boolean;
  metaDataColumns?: MetaDataColumnConfig[];
  attachmentProperties?: AttachmentProperties;
  resourceIds?: Record<string, string>;
}

export interface MetaDataColumnConfig {
  name: string;
  type: string;
  mappingName: string;
}

export interface AttachmentProperties {
  type: string;
  properties?: Record<string, unknown>;
}

export interface ExportData {
  metadata?: ChannelMetadata;
  pruningSettings?: PruningSettings;
  channelTags?: string[];
  dependentIds?: string[];
  dependencyIds?: string[];
}

export interface ChannelMetadata {
  enabled?: boolean;
  lastModified?: Date;
  pruningSettings?: PruningSettings;
}

export interface PruningSettings {
  pruneMetaDataDays?: number;
  pruneContentDays?: number;
  archiveEnabled?: boolean;
  pruneErroredMessages?: boolean;
}

export interface CodeTemplateLibrary {
  id: string;
  name: string;
  revision: number;
  description?: string;
  includeNewChannels?: boolean;
  enabledChannelIds?: string[];
  disabledChannelIds?: string[];
  codeTemplates?: CodeTemplate[];
}

export interface CodeTemplate {
  id: string;
  name: string;
  revision: number;
  description?: string;
  type?: string;
  properties?: Record<string, unknown>;
}

export interface ChannelHeader {
  channelId: string;
  revision: number;
}

export interface ChannelSummary {
  channelId: string;
  channel?: Channel;
  deleted?: boolean;
  undeployed?: boolean;
}

export function createEmptyChannel(id: string, name: string): Channel {
  return {
    id,
    name,
    revision: 1,
    enabled: true,
    sourceConnector: {
      metaDataId: 0,
      name: 'Source',
      enabled: true,
      transportName: 'HTTP Listener',
      properties: {},
    },
    destinationConnectors: [
      {
        metaDataId: 1,
        name: 'Destination 1',
        enabled: true,
        transportName: 'Channel Writer',
        properties: {},
      },
    ],
    properties: {
      clearGlobalChannelMap: true,
      messageStorageMode: 'DEVELOPMENT',
      encryptData: false,
      removeContentOnCompletion: false,
      removeOnlyFilteredOnCompletion: false,
      removeAttachmentsOnCompletion: false,
      initialState: DeployedState.STARTED,
      storeAttachments: false,
    },
  };
}
