-- =============================================================================
-- Deep Validation Suite: Message Verification
-- =============================================================================
-- Checks message processing completeness and correctness across DV channels.
--
-- TABLE NAME RESOLUTION:
-- Mirth creates per-channel tables using a LOCAL_CHANNEL_ID assigned at deploy
-- time (not the channel UUID). The mapping is stored in the D_CHANNELS table:
--
--   D_CHANNELS.CHANNEL_ID  = channel UUID (e.g., 'dv000001-...-000000000001')
--   D_CHANNELS.LOCAL_CHANNEL_ID = integer assigned at deploy time (e.g., 1)
--
-- Per-channel table names are formed as: D_M{LOCAL_CHANNEL_ID}, D_MM{LOCAL_CHANNEL_ID}, etc.
-- Since LOCAL_CHANNEL_ID is only known after deployment, we CANNOT hardcode table
-- names in static SQL. Instead, these queries use D_CHANNELS to discover the
-- mapping, and the results should be used by a script to construct dynamic queries.
--
-- For MySQL, we use prepared statements with CONCAT to build dynamic table names.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Channel ID to Local ID Mapping
-- ---------------------------------------------------------------------------
-- Run this first to discover which local IDs were assigned to DV channels.
-- The output drives all subsequent queries.

SELECT
  CHANNEL_ID,
  LOCAL_CHANNEL_ID
FROM D_CHANNELS
WHERE CHANNEL_ID LIKE 'dv%'
ORDER BY CHANNEL_ID;

-- ---------------------------------------------------------------------------
-- 2. Stuck Messages Check (PROCESSED = 0)
-- ---------------------------------------------------------------------------
-- Messages with PROCESSED=0 are still in-flight or stuck. After all test
-- messages have been sent and a settling period has elapsed, there should
-- be zero rows with PROCESSED=0.
--
-- This procedure iterates over all DV channels and checks their D_M tables.
-- Usage: CALL dv_check_stuck_messages();

DROP PROCEDURE IF EXISTS dv_check_stuck_messages;

DELIMITER //
CREATE PROCEDURE dv_check_stuck_messages()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_channel_id VARCHAR(255);
  DECLARE v_local_id BIGINT;
  DECLARE cur CURSOR FOR
    SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  -- Results table
  DROP TEMPORARY TABLE IF EXISTS tmp_stuck_results;
  CREATE TEMPORARY TABLE tmp_stuck_results (
    channel_id VARCHAR(255),
    local_id BIGINT,
    stuck_count BIGINT
  );

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_channel_id, v_local_id;
    IF done THEN LEAVE read_loop; END IF;

    SET @sql = CONCAT(
      'INSERT INTO tmp_stuck_results ',
      'SELECT ''', v_channel_id, ''', ', v_local_id, ', COUNT(*) ',
      'FROM D_M', v_local_id, ' WHERE PROCESSED = 0'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;

  -- Show results: only channels with stuck messages
  SELECT * FROM tmp_stuck_results WHERE stuck_count > 0;

  -- Summary
  SELECT
    COUNT(*) AS channels_checked,
    SUM(CASE WHEN stuck_count > 0 THEN 1 ELSE 0 END) AS channels_with_stuck,
    SUM(stuck_count) AS total_stuck
  FROM tmp_stuck_results;

  DROP TEMPORARY TABLE IF EXISTS tmp_stuck_results;
END //
DELIMITER ;

-- ---------------------------------------------------------------------------
-- 3. Pending Connector Check (STATUS IN ('R','P'))
-- ---------------------------------------------------------------------------
-- Checks D_MM tables for connector metadata rows still in RECEIVED or PENDING
-- status. After processing completes, all connectors should be in a terminal
-- state (S=SENT, E=ERROR, F=FILTERED, Q=QUEUED).
--
-- Usage: CALL dv_check_pending_connectors();

DROP PROCEDURE IF EXISTS dv_check_pending_connectors;

DELIMITER //
CREATE PROCEDURE dv_check_pending_connectors()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_channel_id VARCHAR(255);
  DECLARE v_local_id BIGINT;
  DECLARE cur CURSOR FOR
    SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  DROP TEMPORARY TABLE IF EXISTS tmp_pending_results;
  CREATE TEMPORARY TABLE tmp_pending_results (
    channel_id VARCHAR(255),
    local_id BIGINT,
    metadata_id INT,
    status CHAR(1),
    pending_count BIGINT
  );

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_channel_id, v_local_id;
    IF done THEN LEAVE read_loop; END IF;

    SET @sql = CONCAT(
      'INSERT INTO tmp_pending_results ',
      'SELECT ''', v_channel_id, ''', ', v_local_id,
      ', METADATA_ID, STATUS, COUNT(*) ',
      'FROM D_MM', v_local_id,
      ' WHERE STATUS IN (''R'', ''P'') ',
      'GROUP BY METADATA_ID, STATUS'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;

  -- Show all pending connectors (should be empty after settling)
  SELECT * FROM tmp_pending_results;

  -- Summary
  SELECT
    COUNT(*) AS pending_connector_groups,
    SUM(pending_count) AS total_pending
  FROM tmp_pending_results;

  DROP TEMPORARY TABLE IF EXISTS tmp_pending_results;
END //
DELIMITER ;

-- ---------------------------------------------------------------------------
-- 4. Enrichment Completeness (DV01)
-- ---------------------------------------------------------------------------
-- All rows in dv_enriched_messages should have non-null mrn and event_desc,
-- confirming that the enrichment transformer ran successfully.

-- Rows missing enrichment data (should be zero)
SELECT
  id,
  patient_id,
  mrn,
  event_type,
  event_desc
FROM dv_enriched_messages
WHERE mrn IS NULL
   OR event_desc IS NULL
   OR mrn = ''
   OR event_desc = '';

-- Enrichment completeness summary
SELECT
  COUNT(*) AS total_messages,
  SUM(CASE WHEN mrn IS NOT NULL AND mrn != '' THEN 1 ELSE 0 END) AS with_mrn,
  SUM(CASE WHEN event_desc IS NOT NULL AND event_desc != '' THEN 1 ELSE 0 END) AS with_event_desc,
  SUM(CASE WHEN external_verified = TRUE THEN 1 ELSE 0 END) AS externally_verified,
  ROUND(
    SUM(CASE WHEN mrn IS NOT NULL AND mrn != '' AND event_desc IS NOT NULL AND event_desc != '' THEN 1 ELSE 0 END)
    * 100.0 / NULLIF(COUNT(*), 0), 1
  ) AS enrichment_pct
FROM dv_enriched_messages;

-- ---------------------------------------------------------------------------
-- 5. Route Distribution (DV03-DV05)
-- ---------------------------------------------------------------------------
-- Check that messages were routed to the correct destination tables based on
-- their routing key.

SELECT 'route_a' AS route, COUNT(*) AS msg_count FROM dv_route_a
UNION ALL SELECT 'route_b', COUNT(*) FROM dv_route_b
UNION ALL SELECT 'route_c', COUNT(*) FROM dv_route_c;

-- Verify no misrouted messages (route_key should match the table)
SELECT 'route_a_misrouted' AS check_name, COUNT(*) AS count
FROM dv_route_a WHERE route_key NOT IN ('A', 'a')
UNION ALL
SELECT 'route_b_misrouted', COUNT(*)
FROM dv_route_b WHERE route_key NOT IN ('B', 'b')
UNION ALL
SELECT 'route_c_misrouted', COUNT(*)
FROM dv_route_c WHERE route_key NOT IN ('C', 'c');

-- ---------------------------------------------------------------------------
-- 6. Batch Processing (DV06)
-- ---------------------------------------------------------------------------
-- Check that batch messages were correctly split and each segment recorded.

SELECT
  source_file,
  COUNT(*) AS segments,
  MIN(batch_seq) AS min_seq,
  MAX(batch_seq) AS max_seq
FROM dv_batch_results
GROUP BY source_file;

-- ---------------------------------------------------------------------------
-- 7. VM Chain Results (DV09-DV12)
-- ---------------------------------------------------------------------------
-- Check that messages traversed the full 4-hop chain.

SELECT
  chain_id,
  hop_count,
  source_channel_ids,
  source_message_ids
FROM dv_chain_results
ORDER BY created_at;

-- Messages that did NOT complete the full chain (hop_count should be 4)
SELECT
  chain_id,
  hop_count
FROM dv_chain_results
WHERE hop_count < 4;

-- ---------------------------------------------------------------------------
-- 8. Overall Landing Table Summary
-- ---------------------------------------------------------------------------
SELECT * FROM dv_message_summary;
