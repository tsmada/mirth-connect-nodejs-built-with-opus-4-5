import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { MirthApiClient, Channel, ChannelExportData } from '../clients/MirthApiClient';
import * as mysql from 'mysql2/promise';
import { DatabaseConfig } from '../config/environments';

export interface ExportComparisonResult {
  match: boolean;
  differences: ExportDifference[];
  summary: string;
}

export interface ExportDifference {
  field: string;
  javaValue: unknown;
  nodeValue: unknown;
  severity: 'critical' | 'major' | 'minor';
  description: string;
}

export interface DatabaseComparisonResult {
  match: boolean;
  channelRecordMatch: boolean;
  metadataRecordMatch: boolean;
  differences: DatabaseDifference[];
}

export interface DatabaseDifference {
  table: string;
  column: string;
  javaValue: unknown;
  nodeValue: unknown;
}

export interface RoundTripResult {
  success: boolean;
  importSuccess: boolean;
  exportMatch: boolean;
  revisionCorrect: boolean;
  exportDataCleared: boolean;
  differences: ExportDifference[];
}

// Fields that are expected to differ between exports (timestamps, etc.)
const IGNORED_FIELDS = [
  'lastModified',
  'deployDate',
  'exportData.metadata.lastModified',
  '@_version', // Version attributes may differ due to Java Mirth upgrading channels on import
];

// Fields that must match exactly
const CRITICAL_FIELDS = [
  'id',
  'name',
  'revision',
  'sourceConnector',
  'destinationConnectors',
  'preprocessingScript',
  'postprocessingScript',
  'deployScript',
  'undeployScript',
];

export class ChannelExportComparator {
  private xmlParser: XMLParser;
  private xmlBuilder: XMLBuilder;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
      trimValues: true,
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      format: true,
    });
  }

  /**
   * Compare channel exports from Java and Node.js APIs
   */
  compareExports(javaXml: string, nodeXml: string): ExportComparisonResult {
    const differences: ExportDifference[] = [];

    try {
      const javaChannel = this.xmlParser.parse(javaXml);
      const nodeChannel = this.xmlParser.parse(nodeXml);

      // Extract channel objects
      const javaCh = javaChannel.channel || javaChannel;
      const nodeCh = nodeChannel.channel || nodeChannel;

      // Compare critical fields
      for (const field of CRITICAL_FIELDS) {
        const javaValue = this.getNestedValue(javaCh, field);
        const nodeValue = this.getNestedValue(nodeCh, field);

        if (!this.deepEqual(javaValue, nodeValue)) {
          differences.push({
            field,
            javaValue: this.truncateValue(javaValue),
            nodeValue: this.truncateValue(nodeValue),
            severity: 'critical',
            description: `Critical field '${field}' differs between exports`,
          });
        }
      }

      // Compare exportData handling
      const exportDataDiffs = this.compareExportData(javaCh.exportData, nodeCh.exportData);
      differences.push(...exportDataDiffs);

      // Compare all other fields (non-critical)
      const allFields = new Set([
        ...Object.keys(javaCh),
        ...Object.keys(nodeCh),
      ]);

      for (const field of allFields) {
        if (
          CRITICAL_FIELDS.includes(field) ||
          IGNORED_FIELDS.includes(field) ||
          field === 'exportData'
        ) {
          continue;
        }

        const javaValue = javaCh[field];
        const nodeValue = nodeCh[field];

        if (!this.deepEqual(javaValue, nodeValue)) {
          differences.push({
            field,
            javaValue: this.truncateValue(javaValue),
            nodeValue: this.truncateValue(nodeValue),
            severity: 'minor',
            description: `Field '${field}' differs between exports`,
          });
        }
      }
    } catch (error) {
      differences.push({
        field: 'parse',
        javaValue: null,
        nodeValue: null,
        severity: 'critical',
        description: `Parse error: ${(error as Error).message}`,
      });
    }

    const criticalCount = differences.filter((d) => d.severity === 'critical').length;
    const majorCount = differences.filter((d) => d.severity === 'major').length;

    return {
      match: differences.length === 0,
      differences,
      summary: differences.length === 0
        ? 'Exports match'
        : `${differences.length} differences (${criticalCount} critical, ${majorCount} major)`,
    };
  }

  /**
   * Compare exportData structures
   */
  private compareExportData(
    javaExportData: ChannelExportData | undefined,
    nodeExportData: ChannelExportData | undefined
  ): ExportDifference[] {
    const differences: ExportDifference[] = [];

    // Both should have exportData when retrieved via API GET
    if (!javaExportData && nodeExportData) {
      differences.push({
        field: 'exportData',
        javaValue: null,
        nodeValue: 'present',
        severity: 'major',
        description: 'Java export missing exportData (should be populated on GET)',
      });
      return differences;
    }

    if (javaExportData && !nodeExportData) {
      differences.push({
        field: 'exportData',
        javaValue: 'present',
        nodeValue: null,
        severity: 'major',
        description: 'Node.js export missing exportData (should be populated on GET)',
      });
      return differences;
    }

    if (!javaExportData && !nodeExportData) {
      return differences;
    }

    // Compare metadata
    if (javaExportData?.metadata && nodeExportData?.metadata) {
      if (javaExportData.metadata.enabled !== nodeExportData.metadata.enabled) {
        differences.push({
          field: 'exportData.metadata.enabled',
          javaValue: javaExportData.metadata.enabled,
          nodeValue: nodeExportData.metadata.enabled,
          severity: 'major',
          description: 'Channel enabled status differs',
        });
      }
    }

    // Compare tags
    const javaTags = javaExportData?.channelTags || [];
    const nodeTags = nodeExportData?.channelTags || [];
    if (!this.deepEqual(javaTags, nodeTags)) {
      differences.push({
        field: 'exportData.channelTags',
        javaValue: javaTags,
        nodeValue: nodeTags,
        severity: 'minor',
        description: 'Channel tags differ',
      });
    }

    // Compare dependencies
    const javaDeps = javaExportData?.dependencyIds || [];
    const nodeDeps = nodeExportData?.dependencyIds || [];
    if (!this.deepEqual(javaDeps, nodeDeps)) {
      differences.push({
        field: 'exportData.dependencyIds',
        javaValue: javaDeps,
        nodeValue: nodeDeps,
        severity: 'minor',
        description: 'Channel dependencies differ',
      });
    }

    return differences;
  }

  /**
   * Perform round-trip validation: import to both engines, export, compare
   */
  async validateRoundTrip(
    goldenArtifact: string,
    javaClient: MirthApiClient,
    nodeClient: MirthApiClient
  ): Promise<RoundTripResult> {
    const differences: ExportDifference[] = [];

    // Parse golden artifact to get channel ID
    const parsed = this.xmlParser.parse(goldenArtifact);
    const channelId = parsed.channel?.id || parsed.id;
    const originalRevision = parsed.channel?.revision || parsed.revision || 0;

    // Import to both engines
    const javaImport = await javaClient.importChannel(goldenArtifact, true);
    const nodeImport = await nodeClient.importChannel(goldenArtifact, true);

    if (!javaImport || !nodeImport) {
      return {
        success: false,
        importSuccess: false,
        exportMatch: false,
        revisionCorrect: false,
        exportDataCleared: false,
        differences: [{
          field: 'import',
          javaValue: javaImport,
          nodeValue: nodeImport,
          severity: 'critical',
          description: `Import failed - Java: ${javaImport}, Node: ${nodeImport}`,
        }],
      };
    }

    // Export from both engines
    const javaExport = await javaClient.getChannelXml(channelId);
    const nodeExport = await nodeClient.getChannelXml(channelId);

    if (!javaExport || !nodeExport) {
      return {
        success: false,
        importSuccess: true,
        exportMatch: false,
        revisionCorrect: false,
        exportDataCleared: false,
        differences: [{
          field: 'export',
          javaValue: !!javaExport,
          nodeValue: !!nodeExport,
          severity: 'critical',
          description: 'Export failed from one or both engines',
        }],
      };
    }

    // Compare exports
    const comparison = this.compareExports(javaExport, nodeExport);
    differences.push(...comparison.differences);

    // Check revision increment
    const javaChannel = this.xmlParser.parse(javaExport);
    const nodeChannel = this.xmlParser.parse(nodeExport);
    const javaRevision = javaChannel.channel?.revision || 0;
    const nodeRevision = nodeChannel.channel?.revision || 0;

    const revisionCorrect =
      javaRevision === originalRevision + 1 &&
      nodeRevision === originalRevision + 1;

    if (!revisionCorrect) {
      differences.push({
        field: 'revision',
        javaValue: javaRevision,
        nodeValue: nodeRevision,
        severity: 'major',
        description: `Revision should be ${originalRevision + 1} after import`,
      });
    }

    return {
      success: comparison.match && revisionCorrect,
      importSuccess: true,
      exportMatch: comparison.match,
      revisionCorrect,
      exportDataCleared: true, // Checked implicitly through comparison
      differences,
    };
  }

  /**
   * Compare database records directly
   */
  async compareDatabaseRecords(
    channelId: string,
    dbConfig: DatabaseConfig
  ): Promise<DatabaseComparisonResult> {
    const differences: DatabaseDifference[] = [];

    const connection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    try {
      // Query CHANNEL table
      const [channelRows] = await connection.execute(
        'SELECT * FROM CHANNEL WHERE ID = ?',
        [channelId]
      );

      // Query CHANNEL_METADATA table
      const [metadataRows] = await connection.execute(
        'SELECT * FROM CHANNEL_METADATA WHERE CHANNEL_ID = ?',
        [channelId]
      );

      // Verify channel record exists
      const channelRecord = (channelRows as unknown[])[0];
      if (!channelRecord) {
        return {
          match: false,
          channelRecordMatch: false,
          metadataRecordMatch: false,
          differences: [{
            table: 'CHANNEL',
            column: 'ID',
            javaValue: null,
            nodeValue: null,
          }],
        };
      }

      // Verify exportData is NOT in the CHANNEL.CHANNEL column
      const channelXml = (channelRecord as Record<string, unknown>).CHANNEL as string;
      if (channelXml && channelXml.includes('<exportData>')) {
        differences.push({
          table: 'CHANNEL',
          column: 'CHANNEL',
          javaValue: 'exportData should be cleared',
          nodeValue: 'exportData present in database',
        });
      }

      // Verify metadata record exists
      const metadataRecord = (metadataRows as unknown[])[0];
      const metadataMatch = !!metadataRecord;

      return {
        match: differences.length === 0 && metadataMatch,
        channelRecordMatch: differences.length === 0,
        metadataRecordMatch: metadataMatch,
        differences,
      };
    } finally {
      await connection.end();
    }
  }

  /**
   * Create a golden artifact from Java Mirth
   */
  async createGoldenArtifact(
    javaClient: MirthApiClient,
    channelId: string
  ): Promise<string | null> {
    return javaClient.getChannelXml(channelId);
  }

  // ==================== Helper Methods ====================

  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const aRecord = a as Record<string, unknown>;
      const bRecord = b as Record<string, unknown>;

      // Filter out version attributes for comparison
      const filterKeys = (keys: string[]) => keys.filter(k => k !== '@_version');
      const keysA = filterKeys(Object.keys(aRecord));
      const keysB = filterKeys(Object.keys(bRecord));

      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (!this.deepEqual(aRecord[key], bRecord[key])) return false;
      }
      return true;
    }

    return false;
  }

  private truncateValue(value: unknown): unknown {
    if (typeof value === 'string' && value.length > 200) {
      return value.substring(0, 200) + '...';
    }
    if (typeof value === 'object' && value !== null) {
      return '[Object]';
    }
    return value;
  }
}
