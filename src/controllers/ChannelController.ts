/**
 * Channel Controller
 *
 * Business logic for channel operations.
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
  Channel,
  ChannelSummary,
  ChannelHeader,
  CodeTemplateLibrary,
} from '../api/models/Channel.js';
import * as MirthDao from '../db/MirthDao.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
});

/**
 * Channel Controller - manages channel CRUD operations
 */
export class ChannelController {
  /**
   * Get all channels
   */
  static async getAllChannels(): Promise<Channel[]> {
    const rows = await MirthDao.getChannels();
    return rows.map((row) => this.parseChannelXml(row.CHANNEL, row.ID, row.NAME, row.REVISION));
  }

  /**
   * Get a single channel by ID
   */
  static async getChannel(channelId: string): Promise<Channel | null> {
    const row = await MirthDao.getChannelById(channelId);
    if (!row) {
      return null;
    }
    return this.parseChannelXml(row.CHANNEL, row.ID, row.NAME, row.REVISION);
  }

  /**
   * Get channel IDs and names map
   */
  static async getChannelIdsAndNames(): Promise<Record<string, string>> {
    const rows = await MirthDao.getChannels();
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.ID] = row.NAME;
    }
    return result;
  }

  /**
   * Get channel summaries for cache synchronization
   */
  static async getChannelSummaries(
    cachedChannels: Record<string, ChannelHeader>,
    ignoreNewChannels: boolean
  ): Promise<ChannelSummary[]> {
    const rows = await MirthDao.getChannels();
    const summaries: ChannelSummary[] = [];
    const currentIds = new Set(rows.map((r) => r.ID));

    // Check for modified or new channels
    for (const row of rows) {
      const cached = cachedChannels[row.ID];

      if (!cached) {
        // New channel
        if (!ignoreNewChannels) {
          summaries.push({
            channelId: row.ID,
            channel: this.parseChannelXml(row.CHANNEL, row.ID, row.NAME, row.REVISION),
          });
        }
      } else if (cached.revision !== row.REVISION) {
        // Modified channel
        summaries.push({
          channelId: row.ID,
          channel: this.parseChannelXml(row.CHANNEL, row.ID, row.NAME, row.REVISION),
        });
      }
    }

    // Check for deleted channels
    for (const channelId of Object.keys(cachedChannels)) {
      if (!currentIds.has(channelId)) {
        summaries.push({
          channelId,
          deleted: true,
        });
      }
    }

    return summaries;
  }

  /**
   * Create a new channel
   */
  static async createChannel(channel: Partial<Channel>): Promise<boolean> {
    if (!channel.id || !channel.name) {
      return false;
    }

    const channelXml = this.serializeChannelToXml(channel as Channel);
    await MirthDao.upsertChannel(channel.id, channel.name, channelXml, channel.revision || 1);
    return true;
  }

  /**
   * Create a new channel, preserving raw XML if provided
   */
  static async createChannelWithXml(channel: Partial<Channel>, rawXml?: string): Promise<boolean> {
    if (!channel.id || !channel.name) {
      return false;
    }

    // Use raw XML if provided, otherwise serialize the channel object
    const channelXml = rawXml || this.serializeChannelToXml(channel as Channel);
    await MirthDao.upsertChannel(channel.id, channel.name, channelXml, channel.revision || 1);
    return true;
  }

  /**
   * Update an existing channel
   */
  static async updateChannel(channelId: string, channel: Partial<Channel>): Promise<boolean> {
    const existing = await MirthDao.getChannelById(channelId);
    if (!existing) {
      return false;
    }

    const updatedChannel = {
      ...this.parseChannelXml(existing.CHANNEL, existing.ID, existing.NAME, existing.REVISION),
      ...channel,
      revision: existing.REVISION + 1,
    };

    const channelXml = this.serializeChannelToXml(updatedChannel);
    await MirthDao.upsertChannel(
      channelId,
      updatedChannel.name,
      channelXml,
      updatedChannel.revision
    );
    return true;
  }

  /**
   * Update an existing channel, preserving raw XML if provided
   */
  static async updateChannelWithXml(
    channelId: string,
    channel: Partial<Channel>,
    rawXml?: string
  ): Promise<boolean> {
    const existing = await MirthDao.getChannelById(channelId);
    if (!existing) {
      return false;
    }

    const newRevision = existing.REVISION + 1;

    // Use raw XML if provided, otherwise serialize the channel object
    let channelXml: string;
    if (rawXml) {
      // Update revision in raw XML
      channelXml = rawXml.replace(
        /<revision>\d+<\/revision>/,
        `<revision>${newRevision}</revision>`
      );
    } else {
      const updatedChannel = {
        ...this.parseChannelXml(existing.CHANNEL, existing.ID, existing.NAME, existing.REVISION),
        ...channel,
        revision: newRevision,
      };
      channelXml = this.serializeChannelToXml(updatedChannel);
    }

    await MirthDao.upsertChannel(channelId, channel.name || existing.NAME, channelXml, newRevision);
    return true;
  }

  /**
   * Delete a channel
   */
  static async deleteChannel(channelId: string): Promise<void> {
    await MirthDao.deleteChannel(channelId);
  }

  /**
   * Get raw channel XML (for exports)
   */
  static async getChannelXml(channelId: string): Promise<string | null> {
    const row = await MirthDao.getChannelById(channelId);
    if (!row) {
      return null;
    }
    return row.CHANNEL;
  }

  /**
   * Set channel enabled status
   */
  static async setChannelEnabled(channelId: string, enabled: boolean): Promise<void> {
    const existing = await MirthDao.getChannelById(channelId);
    if (existing) {
      const channel = this.parseChannelXml(
        existing.CHANNEL,
        existing.ID,
        existing.NAME,
        existing.REVISION
      );
      channel.enabled = enabled;
      const channelXml = this.serializeChannelToXml(channel);
      await MirthDao.upsertChannel(channelId, channel.name, channelXml, channel.revision + 1);
    }
  }

  /**
   * Get code template libraries for a channel
   */
  static async getCodeTemplateLibraries(_channelId: string): Promise<CodeTemplateLibrary[]> {
    // TODO: Implement code template library retrieval
    return [];
  }

  /**
   * Parse channel XML to Channel object
   */
  private static parseChannelXml(xml: string, id: string, name: string, revision: number): Channel {
    try {
      const parsed = xmlParser.parse(xml);
      const channelData = parsed.channel || parsed;

      return {
        id,
        name,
        revision,
        description: channelData.description || '',
        enabled: channelData.enabled !== false,
        sourceConnector: this.parseConnector(channelData.sourceConnector, 0, 'Source'),
        destinationConnectors: this.parseDestinationConnectors(channelData.destinationConnectors),
        preprocessingScript: channelData.preprocessingScript || '',
        postprocessingScript: channelData.postprocessingScript || '',
        deployScript: channelData.deployScript || '',
        undeployScript: channelData.undeployScript || '',
        properties: this.parseChannelProperties(channelData.properties),
      };
    } catch {
      // Return minimal channel if XML parsing fails
      return {
        id,
        name,
        revision,
        enabled: true,
        sourceConnector: {
          metaDataId: 0,
          name: 'Source',
          enabled: true,
          transportName: 'Unknown',
          properties: {},
        },
        destinationConnectors: [],
        properties: {},
      };
    }
  }

  /**
   * Parse connector from XML data
   */
  private static parseConnector(
    data: Record<string, unknown> | undefined,
    defaultMetaDataId: number,
    defaultName: string
  ): Channel['sourceConnector'] {
    if (!data) {
      return {
        metaDataId: defaultMetaDataId,
        name: defaultName,
        enabled: true,
        transportName: 'Unknown',
        properties: {},
      };
    }

    return {
      metaDataId: (data.metaDataId as number) ?? defaultMetaDataId,
      name: (data.name as string) || defaultName,
      enabled: data.enabled !== false,
      transportName: (data.transportName as string) || 'Unknown',
      properties: (data.properties as Record<string, unknown>) || {},
      filter: data.filter as Channel['sourceConnector']['filter'],
      transformer: data.transformer as Channel['sourceConnector']['transformer'],
      responseTransformer:
        data.responseTransformer as Channel['sourceConnector']['responseTransformer'],
      waitForPrevious: data.waitForPrevious as boolean,
      queueEnabled: data.queueEnabled as boolean,
    };
  }

  /**
   * Parse destination connectors
   */
  private static parseDestinationConnectors(
    data: Record<string, unknown> | unknown[] | undefined
  ): Channel['destinationConnectors'] {
    if (!data) {
      return [];
    }

    // Handle XML structure: <destinationConnectors><connector>...</connector></destinationConnectors>
    let connectors: unknown[];
    if (Array.isArray(data)) {
      connectors = data;
    } else {
      const dataObj = data as { connector?: unknown | unknown[] };
      if (!dataObj.connector) {
        return [];
      }
      // Normalize single connector to array
      connectors = Array.isArray(dataObj.connector) ? dataObj.connector : [dataObj.connector];
    }

    return connectors.map((c: unknown, i: number) => {
      const conn = c as Record<string, unknown>;
      return this.parseConnector(conn, i + 1, `Destination ${i + 1}`);
    });
  }

  /**
   * Parse channel properties
   */
  private static parseChannelProperties(
    data: Record<string, unknown> | undefined
  ): Channel['properties'] {
    if (!data) {
      return {};
    }

    return {
      clearGlobalChannelMap: data.clearGlobalChannelMap as boolean,
      messageStorageMode: data.messageStorageMode as string,
      encryptData: data.encryptData as boolean,
      removeContentOnCompletion: data.removeContentOnCompletion as boolean,
      removeOnlyFilteredOnCompletion: data.removeOnlyFilteredOnCompletion as boolean,
      removeAttachmentsOnCompletion: data.removeAttachmentsOnCompletion as boolean,
      initialState: data.initialState as Channel['properties']['initialState'],
      storeAttachments: data.storeAttachments as boolean,
      metaDataColumns: data.metaDataColumns as Channel['properties']['metaDataColumns'],
      attachmentProperties:
        data.attachmentProperties as Channel['properties']['attachmentProperties'],
      resourceIds: data.resourceIds as Record<string, string>,
    };
  }

  /**
   * Serialize channel to XML
   */
  private static serializeChannelToXml(channel: Channel): string {
    const channelData = {
      channel: {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        enabled: channel.enabled,
        revision: channel.revision,
        sourceConnector: channel.sourceConnector,
        destinationConnectors: {
          connector: channel.destinationConnectors,
        },
        preprocessingScript: channel.preprocessingScript,
        postprocessingScript: channel.postprocessingScript,
        deployScript: channel.deployScript,
        undeployScript: channel.undeployScript,
        properties: channel.properties,
      },
    };

    return xmlBuilder.build(channelData);
  }
}
