/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/datatype/DefaultMetaData.java
 *
 * Purpose: Constants for custom metadata column variable mappings.
 * These keys are used when populating D_MCM (custom metadata) tables.
 *
 * CRITICAL: Java Mirth uses 'mirth_source', 'mirth_type', 'mirth_version' as the
 * column names in D_MCM tables. Any deviation causes silent data corruption in
 * takeover mode — rows written by Node.js would be invisible to Java Mirth queries.
 */

/** Custom metadata column name for message source (e.g., sending facility) */
export const SOURCE_VARIABLE_MAPPING = 'mirth_source';

/** Custom metadata column name for message type (e.g., ADT-A01, 270, CDA) */
export const TYPE_VARIABLE_MAPPING = 'mirth_type';

/** Custom metadata column name for message version (e.g., 2.5.1, 005010X279A1) */
export const VERSION_VARIABLE_MAPPING = 'mirth_version';
