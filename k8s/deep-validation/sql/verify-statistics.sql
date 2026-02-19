-- =============================================================================
-- Deep Validation Suite: Statistics Verification
-- =============================================================================
-- Compares Mirth's internal statistics (D_MS tables) against actual message
-- counts in D_MM tables. Discrepancies indicate statistics tracking bugs.
--
-- TABLE NAME RESOLUTION:
-- Per-channel tables use LOCAL_CHANNEL_ID from D_CHANNELS (see verify-messages.sql
-- for full explanation). This file uses stored procedures with dynamic SQL
-- to iterate over DV channels and compare statistics.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Statistics vs Actual Message Count Comparison
-- ---------------------------------------------------------------------------
-- For each DV channel, compares:
--   D_MS.RECEIVED (statistics counter) vs COUNT(*) FROM D_MM WHERE METADATA_ID=0
--
-- METADATA_ID=0 is the source connector. Each message has exactly one source
-- connector metadata row, so COUNT(*) from D_MM WHERE METADATA_ID=0 equals
-- the total received message count.
--
-- Usage: CALL dv_verify_statistics();

DROP PROCEDURE IF EXISTS dv_verify_statistics;

DELIMITER //
CREATE PROCEDURE dv_verify_statistics()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_channel_id VARCHAR(255);
  DECLARE v_local_id BIGINT;
  DECLARE cur CURSOR FOR
    SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  DROP TEMPORARY TABLE IF EXISTS tmp_stats_comparison;
  CREATE TEMPORARY TABLE tmp_stats_comparison (
    channel_id VARCHAR(255),
    local_id BIGINT,
    stat_received BIGINT DEFAULT 0,
    stat_sent BIGINT DEFAULT 0,
    stat_error BIGINT DEFAULT 0,
    stat_filtered BIGINT DEFAULT 0,
    stat_queued BIGINT DEFAULT 0,
    actual_total BIGINT DEFAULT 0,
    actual_sent BIGINT DEFAULT 0,
    actual_error BIGINT DEFAULT 0,
    actual_filtered BIGINT DEFAULT 0,
    actual_queued BIGINT DEFAULT 0,
    received_match BOOLEAN DEFAULT FALSE,
    sent_match BOOLEAN DEFAULT FALSE,
    error_match BOOLEAN DEFAULT FALSE
  );

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_channel_id, v_local_id;
    IF done THEN LEAVE read_loop; END IF;

    -- Insert a row for this channel
    INSERT INTO tmp_stats_comparison (channel_id, local_id)
    VALUES (v_channel_id, v_local_id);

    -- Read D_MS statistics (METADATA_ID=0 is the source connector stats).
    -- D_MS columns: METADATA_ID, SERVER_ID, RECEIVED, FILTERED, TRANSFORMED,
    --               SENT, QUEUED, ERROR
    -- We SUM across all SERVER_IDs for cluster compatibility.
    SET @sql = CONCAT(
      'UPDATE tmp_stats_comparison SET ',
      'stat_received = COALESCE((',
        'SELECT SUM(RECEIVED) FROM D_MS', v_local_id,
        ' WHERE METADATA_ID = 0), 0), ',
      'stat_sent = COALESCE((',
        'SELECT SUM(SENT) FROM D_MS', v_local_id,
        ' WHERE METADATA_ID = 0), 0), ',
      'stat_error = COALESCE((',
        'SELECT SUM(ERROR) FROM D_MS', v_local_id,
        ' WHERE METADATA_ID = 0), 0), ',
      'stat_filtered = COALESCE((',
        'SELECT SUM(FILTERED) FROM D_MS', v_local_id,
        ' WHERE METADATA_ID = 0), 0), ',
      'stat_queued = COALESCE((',
        'SELECT SUM(QUEUED) FROM D_MS', v_local_id,
        ' WHERE METADATA_ID = 0), 0) ',
      'WHERE channel_id = ''', v_channel_id, ''''
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    -- Count actual messages from D_MM (METADATA_ID=0 = source connector row).
    SET @sql = CONCAT(
      'UPDATE tmp_stats_comparison SET ',
      'actual_total = COALESCE((',
        'SELECT COUNT(*) FROM D_MM', v_local_id,
        ' WHERE METADATA_ID = 0), 0), ',
      'actual_sent = COALESCE((',
        'SELECT COUNT(*) FROM D_MM', v_local_id,
        ' WHERE METADATA_ID = 0 AND STATUS = ''S''), 0), ',
      'actual_error = COALESCE((',
        'SELECT COUNT(*) FROM D_MM', v_local_id,
        ' WHERE METADATA_ID = 0 AND STATUS = ''E''), 0), ',
      'actual_filtered = COALESCE((',
        'SELECT COUNT(*) FROM D_MM', v_local_id,
        ' WHERE METADATA_ID = 0 AND STATUS = ''F''), 0), ',
      'actual_queued = COALESCE((',
        'SELECT COUNT(*) FROM D_MM', v_local_id,
        ' WHERE METADATA_ID = 0 AND STATUS = ''Q''), 0) ',
      'WHERE channel_id = ''', v_channel_id, ''''
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    -- Compute match flags
    UPDATE tmp_stats_comparison SET
      received_match = (stat_received = actual_total),
      sent_match = (stat_sent = actual_sent),
      error_match = (stat_error = actual_error)
    WHERE channel_id = v_channel_id;

  END LOOP;
  CLOSE cur;

  -- Full comparison table
  SELECT
    channel_id,
    local_id,
    stat_received,
    actual_total,
    CASE WHEN received_match THEN 'OK' ELSE 'MISMATCH' END AS received_check,
    stat_sent,
    actual_sent,
    CASE WHEN sent_match THEN 'OK' ELSE 'MISMATCH' END AS sent_check,
    stat_error,
    actual_error,
    CASE WHEN error_match THEN 'OK' ELSE 'MISMATCH' END AS error_check,
    stat_filtered,
    actual_filtered,
    stat_queued,
    actual_queued
  FROM tmp_stats_comparison
  ORDER BY channel_id;

  -- Summary: channels with mismatches only
  SELECT
    channel_id,
    stat_received AS stat_recv,
    actual_total AS actual_recv,
    stat_sent,
    actual_sent,
    stat_error,
    actual_error
  FROM tmp_stats_comparison
  WHERE NOT received_match OR NOT sent_match OR NOT error_match;

  -- Overall pass/fail
  SELECT
    COUNT(*) AS channels_checked,
    SUM(CASE WHEN received_match AND sent_match AND error_match THEN 1 ELSE 0 END) AS channels_passing,
    SUM(CASE WHEN NOT received_match OR NOT sent_match OR NOT error_match THEN 1 ELSE 0 END) AS channels_failing
  FROM tmp_stats_comparison;

  DROP TEMPORARY TABLE IF EXISTS tmp_stats_comparison;
END //
DELIMITER ;

-- ---------------------------------------------------------------------------
-- 2. DV08 Error Channel: Detailed Error Statistics
-- ---------------------------------------------------------------------------
-- DV08 is the error injection channel. This query specifically verifies that
-- the error count in D_MS matches actual ERROR status rows in D_MM.
--
-- Usage: CALL dv_verify_error_stats();

DROP PROCEDURE IF EXISTS dv_verify_error_stats;

DELIMITER //
CREATE PROCEDURE dv_verify_error_stats()
BEGIN
  DECLARE v_local_id BIGINT;

  -- Find DV08's local channel ID
  -- DV08 channel UUID pattern: dv000008-...
  SELECT LOCAL_CHANNEL_ID INTO v_local_id
  FROM D_CHANNELS
  WHERE CHANNEL_ID LIKE 'dv000008%'
  LIMIT 1;

  IF v_local_id IS NULL THEN
    SELECT 'DV08 channel not found in D_CHANNELS' AS error_message;
  ELSE
    -- Compare error stats across all connectors (source + destinations)
    SET @sql = CONCAT(
      'SELECT ',
      '  ms.METADATA_ID, ',
      '  ms_error AS stat_error_count, ',
      '  mm_error AS actual_error_count, ',
      '  CASE WHEN ms_error = mm_error THEN ''OK'' ELSE ''MISMATCH'' END AS check_result ',
      'FROM ( ',
      '  SELECT METADATA_ID, SUM(ERROR) AS ms_error FROM D_MS', v_local_id,
      '  GROUP BY METADATA_ID ',
      ') ms ',
      'JOIN ( ',
      '  SELECT METADATA_ID, COUNT(*) AS mm_error FROM D_MM', v_local_id,
      '  WHERE STATUS = ''E'' GROUP BY METADATA_ID ',
      ') mm ON ms.METADATA_ID = mm.METADATA_ID'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    -- Also show total error content rows in D_MC (error messages persisted)
    SET @sql = CONCAT(
      'SELECT COUNT(*) AS error_content_rows ',
      'FROM D_MC', v_local_id,
      ' WHERE CONTENT_TYPE IN (4, 6, 8, 10, 12, 14)'
    );
    -- Content types: 4=TRANSFORMER_ERROR, 6=CONNECTOR_ERROR, 8=SOURCE_ERROR,
    -- 10=DESTINATION_ERROR, 12=PROCESSING_ERROR, 14=RESPONSE_ERROR
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------------
-- 3. Per-Destination Statistics Verification
-- ---------------------------------------------------------------------------
-- For channels with multiple destinations (DV02 JSON Gateway, DV03-DV05 Router),
-- verify that destination-level statistics in D_MS match D_MM counts.
--
-- Usage: CALL dv_verify_destination_stats();

DROP PROCEDURE IF EXISTS dv_verify_destination_stats;

DELIMITER //
CREATE PROCEDURE dv_verify_destination_stats()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_channel_id VARCHAR(255);
  DECLARE v_local_id BIGINT;
  DECLARE cur CURSOR FOR
    SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  DROP TEMPORARY TABLE IF EXISTS tmp_dest_stats;
  CREATE TEMPORARY TABLE tmp_dest_stats (
    channel_id VARCHAR(255),
    metadata_id INT,
    stat_sent BIGINT,
    actual_sent BIGINT,
    stat_error BIGINT,
    actual_error BIGINT,
    match_ok BOOLEAN
  );

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_channel_id, v_local_id;
    IF done THEN LEAVE read_loop; END IF;

    -- Compare per-destination (METADATA_ID > 0) stats
    SET @sql = CONCAT(
      'INSERT INTO tmp_dest_stats ',
      'SELECT ''', v_channel_id, ''', ',
      '  ms.METADATA_ID, ',
      '  COALESCE(ms.ms_sent, 0), ',
      '  COALESCE(mm.mm_sent, 0), ',
      '  COALESCE(ms.ms_error, 0), ',
      '  COALESCE(mm.mm_error, 0), ',
      '  (COALESCE(ms.ms_sent, 0) = COALESCE(mm.mm_sent, 0) AND ',
      '   COALESCE(ms.ms_error, 0) = COALESCE(mm.mm_error, 0)) ',
      'FROM ( ',
      '  SELECT METADATA_ID, SUM(SENT) AS ms_sent, SUM(ERROR) AS ms_error ',
      '  FROM D_MS', v_local_id,
      '  WHERE METADATA_ID > 0 GROUP BY METADATA_ID ',
      ') ms ',
      'LEFT JOIN ( ',
      '  SELECT METADATA_ID, ',
      '    SUM(CASE WHEN STATUS = ''S'' THEN 1 ELSE 0 END) AS mm_sent, ',
      '    SUM(CASE WHEN STATUS = ''E'' THEN 1 ELSE 0 END) AS mm_error ',
      '  FROM D_MM', v_local_id,
      '  WHERE METADATA_ID > 0 GROUP BY METADATA_ID ',
      ') mm ON ms.METADATA_ID = mm.METADATA_ID'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;

  -- Show mismatches only
  SELECT * FROM tmp_dest_stats WHERE NOT match_ok;

  -- Summary
  SELECT
    COUNT(*) AS destinations_checked,
    SUM(CASE WHEN match_ok THEN 1 ELSE 0 END) AS matching,
    SUM(CASE WHEN NOT match_ok THEN 1 ELSE 0 END) AS mismatched
  FROM tmp_dest_stats;

  DROP TEMPORARY TABLE IF EXISTS tmp_dest_stats;
END //
DELIMITER ;
