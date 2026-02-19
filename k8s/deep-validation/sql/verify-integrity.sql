-- =============================================================================
-- Deep Validation Suite: Data Integrity Verification
-- =============================================================================
-- Checks structural integrity of Mirth's per-channel tables:
--   - No orphaned content rows (D_MC without matching D_MM)
--   - No duplicate MESSAGE_IDs in D_M tables
--   - Server ID distribution across D_M tables (cluster verification)
--   - Custom metadata persistence for DV06 (D_MCM rows exist)
--
-- All queries use D_CHANNELS for LOCAL_CHANNEL_ID resolution.
-- See verify-messages.sql for table name resolution explanation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Orphaned Content Rows (D_MC without matching D_MM)
-- ---------------------------------------------------------------------------
-- Every D_MC row should have a corresponding D_MM row with the same
-- MESSAGE_ID and METADATA_ID. Orphaned rows indicate incomplete cleanup
-- or a bug in the storage manager.
--
-- Usage: CALL dv_check_orphaned_content();

DROP PROCEDURE IF EXISTS dv_check_orphaned_content;

DELIMITER //
CREATE PROCEDURE dv_check_orphaned_content()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_channel_id VARCHAR(255);
  DECLARE v_local_id BIGINT;
  DECLARE cur CURSOR FOR
    SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  DROP TEMPORARY TABLE IF EXISTS tmp_orphan_results;
  CREATE TEMPORARY TABLE tmp_orphan_results (
    channel_id VARCHAR(255),
    local_id BIGINT,
    orphan_count BIGINT
  );

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_channel_id, v_local_id;
    IF done THEN LEAVE read_loop; END IF;

    -- Count D_MC rows that have no matching D_MM row
    SET @sql = CONCAT(
      'INSERT INTO tmp_orphan_results ',
      'SELECT ''', v_channel_id, ''', ', v_local_id, ', COUNT(*) ',
      'FROM D_MC', v_local_id, ' mc ',
      'LEFT JOIN D_MM', v_local_id, ' mm ',
      '  ON mc.MESSAGE_ID = mm.MESSAGE_ID ',
      '  AND mc.METADATA_ID = mm.METADATA_ID ',
      'WHERE mm.MESSAGE_ID IS NULL'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;

  -- Show channels with orphaned content (should be empty)
  SELECT * FROM tmp_orphan_results WHERE orphan_count > 0;

  -- Summary
  SELECT
    COUNT(*) AS channels_checked,
    SUM(CASE WHEN orphan_count > 0 THEN 1 ELSE 0 END) AS channels_with_orphans,
    SUM(orphan_count) AS total_orphans
  FROM tmp_orphan_results;

  DROP TEMPORARY TABLE IF EXISTS tmp_orphan_results;
END //
DELIMITER ;

-- ---------------------------------------------------------------------------
-- 2. Duplicate MESSAGE_ID Check
-- ---------------------------------------------------------------------------
-- Each MESSAGE_ID in a D_M table should be unique. Duplicates indicate a
-- sequence allocation bug (SequenceAllocator) or a recovery task error.
--
-- Usage: CALL dv_check_duplicate_message_ids();

DROP PROCEDURE IF EXISTS dv_check_duplicate_message_ids;

DELIMITER //
CREATE PROCEDURE dv_check_duplicate_message_ids()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_channel_id VARCHAR(255);
  DECLARE v_local_id BIGINT;
  DECLARE cur CURSOR FOR
    SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  DROP TEMPORARY TABLE IF EXISTS tmp_dup_results;
  CREATE TEMPORARY TABLE tmp_dup_results (
    channel_id VARCHAR(255),
    local_id BIGINT,
    message_id BIGINT,
    occurrence_count BIGINT
  );

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_channel_id, v_local_id;
    IF done THEN LEAVE read_loop; END IF;

    -- Find MESSAGE_IDs that appear more than once
    SET @sql = CONCAT(
      'INSERT INTO tmp_dup_results ',
      'SELECT ''', v_channel_id, ''', ', v_local_id,
      ', MESSAGE_ID, COUNT(*) ',
      'FROM D_M', v_local_id,
      ' GROUP BY MESSAGE_ID HAVING COUNT(*) > 1'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;

  -- Show duplicates (should be empty)
  SELECT * FROM tmp_dup_results;

  -- Summary
  SELECT
    CASE WHEN COUNT(*) = 0
      THEN 'PASS: No duplicate MESSAGE_IDs found'
      ELSE CONCAT('FAIL: ', COUNT(*), ' duplicate MESSAGE_IDs across ',
                   COUNT(DISTINCT channel_id), ' channels')
    END AS result
  FROM tmp_dup_results;

  DROP TEMPORARY TABLE IF EXISTS tmp_dup_results;
END //
DELIMITER ;

-- ---------------------------------------------------------------------------
-- 3. Server ID Distribution
-- ---------------------------------------------------------------------------
-- In cluster mode, messages are distributed across multiple server instances.
-- This checks the SERVER_ID column in D_M tables to verify distribution.
-- In single-node mode, all messages should have the same SERVER_ID.
--
-- Usage: CALL dv_check_server_distribution();

DROP PROCEDURE IF EXISTS dv_check_server_distribution;

DELIMITER //
CREATE PROCEDURE dv_check_server_distribution()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_channel_id VARCHAR(255);
  DECLARE v_local_id BIGINT;
  DECLARE cur CURSOR FOR
    SELECT CHANNEL_ID, LOCAL_CHANNEL_ID FROM D_CHANNELS WHERE CHANNEL_ID LIKE 'dv%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  DROP TEMPORARY TABLE IF EXISTS tmp_server_dist;
  CREATE TEMPORARY TABLE tmp_server_dist (
    channel_id VARCHAR(255),
    server_id VARCHAR(255),
    message_count BIGINT
  );

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_channel_id, v_local_id;
    IF done THEN LEAVE read_loop; END IF;

    SET @sql = CONCAT(
      'INSERT INTO tmp_server_dist ',
      'SELECT ''', v_channel_id, ''', SERVER_ID, COUNT(*) ',
      'FROM D_M', v_local_id,
      ' GROUP BY SERVER_ID'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;

  -- Distribution per channel
  SELECT
    channel_id,
    server_id,
    message_count,
    ROUND(
      message_count * 100.0 / SUM(message_count) OVER (PARTITION BY channel_id), 1
    ) AS pct_of_channel
  FROM tmp_server_dist
  ORDER BY channel_id, message_count DESC;

  -- Aggregate: unique server IDs and total messages per server
  SELECT
    server_id,
    COUNT(DISTINCT channel_id) AS channels_served,
    SUM(message_count) AS total_messages
  FROM tmp_server_dist
  GROUP BY server_id
  ORDER BY total_messages DESC;

  -- Node count summary
  SELECT
    COUNT(DISTINCT server_id) AS unique_server_ids,
    SUM(message_count) AS total_messages
  FROM tmp_server_dist;

  DROP TEMPORARY TABLE IF EXISTS tmp_server_dist;
END //
DELIMITER ;

-- ---------------------------------------------------------------------------
-- 4. Custom Metadata Persistence (DV06 Batch Processor)
-- ---------------------------------------------------------------------------
-- DV06 (batch processor) should persist custom metadata via D_MCM tables.
-- This verifies that D_MCM rows exist for DV06 messages, confirming that
-- custom metadata columns were created and populated.
--
-- Usage: CALL dv_check_custom_metadata();

DROP PROCEDURE IF EXISTS dv_check_custom_metadata;

DELIMITER //
CREATE PROCEDURE dv_check_custom_metadata()
BEGIN
  DECLARE v_local_id BIGINT;
  DECLARE v_msg_count BIGINT;
  DECLARE v_mcm_count BIGINT;

  -- Find DV06's local channel ID
  SELECT LOCAL_CHANNEL_ID INTO v_local_id
  FROM D_CHANNELS
  WHERE CHANNEL_ID LIKE 'dv000006%'
  LIMIT 1;

  IF v_local_id IS NULL THEN
    SELECT 'DV06 channel not found in D_CHANNELS' AS error_message;
  ELSE
    -- Count messages in D_M
    SET @sql = CONCAT('SELECT COUNT(*) INTO @msg_count FROM D_M', v_local_id);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    -- Count custom metadata rows in D_MCM
    SET @sql = CONCAT('SELECT COUNT(*) INTO @mcm_count FROM D_MCM', v_local_id);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    SELECT
      v_local_id AS dv06_local_id,
      @msg_count AS message_count,
      @mcm_count AS custom_metadata_rows,
      CASE
        WHEN @mcm_count > 0 THEN 'PASS: Custom metadata persisted'
        WHEN @msg_count = 0 THEN 'SKIP: No messages processed yet'
        ELSE 'FAIL: Messages exist but no custom metadata rows'
      END AS result;

    -- Show sample custom metadata if available
    IF @mcm_count > 0 THEN
      SET @sql = CONCAT('SELECT * FROM D_MCM', v_local_id, ' LIMIT 5');
      PREPARE stmt FROM @sql;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;
  END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------------
-- 5. Run All Integrity Checks
-- ---------------------------------------------------------------------------
-- Convenience procedure that runs all integrity checks in sequence.
--
-- Usage: CALL dv_run_all_integrity_checks();

DROP PROCEDURE IF EXISTS dv_run_all_integrity_checks;

DELIMITER //
CREATE PROCEDURE dv_run_all_integrity_checks()
BEGIN
  SELECT '=== Orphaned Content Check ===' AS section;
  CALL dv_check_orphaned_content();

  SELECT '=== Duplicate MESSAGE_ID Check ===' AS section;
  CALL dv_check_duplicate_message_ids();

  SELECT '=== Server ID Distribution ===' AS section;
  CALL dv_check_server_distribution();

  SELECT '=== Custom Metadata (DV06) ===' AS section;
  CALL dv_check_custom_metadata();
END //
DELIMITER ;
