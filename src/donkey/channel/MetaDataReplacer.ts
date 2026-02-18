/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/MetaDataReplacer.java
 *
 * Purpose: Extracts custom metadata column values from connector message maps
 * and prepares them for storage in D_MCM tables.
 *
 * Key behaviors to replicate:
 * - Check maps in priority order: connectorMap > channelMap > sourceMap
 * - Cast values to the configured column type (STRING, NUMBER, BOOLEAN, TIMESTAMP)
 * - STRING values truncated to 255 chars (matches MySQL VARCHAR(255))
 * - NUMBER values capped at 10^16
 * - Errors during casting are logged but do not halt processing
 * - Skip columns with empty mappingName
 * - Null/undefined values are skipped
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { MetaDataColumn, MetaDataColumnType } from '../../api/models/ServerSettings.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('engine', 'Channel deploy/start/stop');
const logger = getLogger('engine');

const MAX_STRING_LENGTH = 255;
const MAX_NUMBER_VALUE = 1e16;

/**
 * Extract custom metadata values from a connector message's maps
 * based on configured column definitions and return them as a record.
 *
 * Checks connectorMap, channelMap, and sourceMap (in that priority order)
 * matching Java Mirth's MetaDataReplacer.getMetaDataValue().
 */
export function setMetaDataMap(
  connectorMessage: ConnectorMessage,
  columns: MetaDataColumn[]
): Map<string, unknown> {
  const metaDataMap = new Map<string, unknown>();

  for (const column of columns) {
    if (!column.mappingName) {
      continue;
    }

    const value = getMetaDataValue(connectorMessage, column);

    if (value != null) {
      try {
        const castVal = castValue(column.type, value);
        if (castVal != null) {
          metaDataMap.set(column.name, castVal);
        }
      } catch (e) {
        // Match Java behavior: log a warning but continue processing.
        // Metadata values are not essential for message processing.
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(
          `MetaDataReplacer: Could not cast value '${String(value)}' to ${column.type}: ${msg}`
        );
      }
    }
  }

  return metaDataMap;
}

/**
 * Look up a metadata column value from connector message maps.
 * Priority: connectorMap > channelMap > sourceMap
 *
 * Matches Java MetaDataReplacer.getMetaDataValue()
 */
export function getMetaDataValue(
  connectorMessage: ConnectorMessage,
  column: MetaDataColumn
): unknown {
  const connectorMap = connectorMessage.getConnectorMap();
  if (connectorMap.has(column.mappingName)) {
    return connectorMap.get(column.mappingName);
  }

  const channelMap = connectorMessage.getChannelMap();
  if (channelMap.has(column.mappingName)) {
    return channelMap.get(column.mappingName);
  }

  const sourceMap = connectorMessage.getSourceMap();
  if (sourceMap.has(column.mappingName)) {
    return sourceMap.get(column.mappingName);
  }

  return undefined;
}

/**
 * Cast a value to the expected metadata column type.
 * Matches Java MetaDataColumnType.castValue() behavior:
 * - STRING: toString, truncate to 255 chars
 * - NUMBER: parse to number, reject >= 10^16
 * - BOOLEAN: convert truthy strings ("true", "yes", "1", "on")
 * - TIMESTAMP: parse to Date
 *
 * @throws Error if the value cannot be cast to the target type
 */
export function castValue(type: MetaDataColumnType, value: unknown): unknown {
  if (value == null) {
    return null;
  }

  switch (type) {
    case MetaDataColumnType.STRING: {
      let str = String(value);
      if (str.length > MAX_STRING_LENGTH) {
        str = str.substring(0, MAX_STRING_LENGTH);
      }
      return str;
    }

    case MetaDataColumnType.NUMBER: {
      const num = Number(value);
      if (isNaN(num)) {
        throw new Error(`Cannot convert '${String(value)}' to number`);
      }
      if (num >= MAX_NUMBER_VALUE) {
        throw new Error(
          `Number ${num} is greater than or equal to the maximum allowed value of 10^16`
        );
      }
      return num;
    }

    case MetaDataColumnType.BOOLEAN: {
      if (typeof value === 'boolean') {
        return value;
      }
      const str = String(value).toLowerCase().trim();
      // Match Apache BooleanConverter behavior
      if (['true', 'yes', '1', 'on', 'y'].includes(str)) {
        return true;
      }
      if (['false', 'no', '0', 'off', 'n'].includes(str)) {
        return false;
      }
      throw new Error(`Cannot convert '${String(value)}' to boolean`);
    }

    case MetaDataColumnType.TIMESTAMP: {
      if (value instanceof Date) {
        if (isNaN(value.getTime())) {
          throw new Error(`Invalid Date object`);
        }
        return value;
      }
      const date = new Date(String(value));
      if (isNaN(date.getTime())) {
        throw new Error(`Cannot parse '${String(value)}' as timestamp`);
      }
      return date;
    }

    default:
      throw new Error(`Unrecognized MetaDataColumnType: ${String(type)}`);
  }
}
