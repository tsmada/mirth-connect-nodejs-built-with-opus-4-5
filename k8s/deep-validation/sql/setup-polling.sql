-- =============================================================================
-- Polling Coordination Validation: Database Setup
-- =============================================================================
-- Creates the DV_POLL_AUDIT landing table used by PC01-PC04 polling channels.
-- Each row records which file was processed, by which channel, on which server.
-- This allows the verification scripts to confirm exclusive processing
-- (no duplicates) and correct lease failover behavior.
--
-- Run against the Mirth Connect database before deploying PC channels.
-- =============================================================================

CREATE TABLE IF NOT EXISTS DV_POLL_AUDIT (
  ID INT AUTO_INCREMENT PRIMARY KEY,
  FILE_NAME VARCHAR(255) NOT NULL,
  CHANNEL_ID VARCHAR(36) NOT NULL,
  SERVER_ID VARCHAR(255) NOT NULL,
  PROCESSED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_poll_file (FILE_NAME),
  INDEX idx_poll_server (SERVER_ID),
  INDEX idx_poll_channel (CHANNEL_ID)
) ENGINE=InnoDB;

-- Clean slate for each validation run
TRUNCATE TABLE DV_POLL_AUDIT;

-- Also reset any stale polling leases from prior runs
-- (D_POLLING_LEASES is created by SchemaManager)
TRUNCATE TABLE D_POLLING_LEASES;
