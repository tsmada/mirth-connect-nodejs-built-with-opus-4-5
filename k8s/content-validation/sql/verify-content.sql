-- =============================================================================
-- Content Validation Suite: Content Verification Queries
-- =============================================================================
-- Reference SQL templates for content verification. The actual execution is
-- performed by verify-content.sh with dynamic table name resolution.
--
-- TABLE NAME RESOLUTION:
-- Mirth creates per-channel tables using a LOCAL_CHANNEL_ID assigned at deploy
-- time (not the channel UUID). The mapping is stored in the D_CHANNELS table:
--
--   D_CHANNELS.CHANNEL_ID  = channel UUID (e.g., 'cv000001-...-000000000001')
--   D_CHANNELS.LOCAL_CHANNEL_ID = integer assigned at deploy time (e.g., 1)
--
-- Per-channel table names are formed as: D_M{LOCAL_CHANNEL_ID}, D_MM{LOCAL_CHANNEL_ID}, etc.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Resolve channel IDs to local IDs
-- ---------------------------------------------------------------------------
SELECT CHANNEL_ID, LOCAL_CHANNEL_ID
FROM D_CHANNELS
WHERE CHANNEL_ID LIKE 'cv%'
ORDER BY CHANNEL_ID;

-- ---------------------------------------------------------------------------
-- 2. Query content by type for a channel
-- ---------------------------------------------------------------------------
-- Template: replace {LOCAL_ID}, {MSG_ID}, {META_ID}, {CONTENT_TYPE}
-- SELECT CONTENT FROM D_MC{LOCAL_ID}
--   WHERE MESSAGE_ID = {MSG_ID}
--     AND METADATA_ID = {META_ID}
--     AND CONTENT_TYPE = {CONTENT_TYPE};

-- ---------------------------------------------------------------------------
-- 3. Query message status
-- ---------------------------------------------------------------------------
-- Template: replace {LOCAL_ID}
-- SELECT MESSAGE_ID, METADATA_ID, STATUS
--   FROM D_MM{LOCAL_ID}
--   ORDER BY MESSAGE_ID, METADATA_ID;

-- ---------------------------------------------------------------------------
-- 4. Count content types per message
-- ---------------------------------------------------------------------------
-- Template: replace {LOCAL_ID}, {MSG_ID}
-- SELECT CONTENT_TYPE, COUNT(*)
--   FROM D_MC{LOCAL_ID}
--   WHERE MESSAGE_ID = {MSG_ID}
--   GROUP BY CONTENT_TYPE;

-- ---------------------------------------------------------------------------
-- Content Type Reference (from Java Mirth)
-- ---------------------------------------------------------------------------
--  1 = RAW
--  2 = PROCESSED_RAW
--  3 = TRANSFORMED
--  4 = ENCODED
--  5 = SENT
--  6 = RESPONSE
--  7 = RESPONSE_TRANSFORMED
--  8 = PROCESSED_RESPONSE
--  9 = CONNECTOR_MAP
-- 10 = CHANNEL_MAP
-- 11 = RESPONSE_MAP
-- 12 = PROCESSING_ERROR
-- 13 = POSTPROCESSOR_ERROR
-- 14 = RESPONSE_ERROR
-- 15 = SOURCE_MAP
