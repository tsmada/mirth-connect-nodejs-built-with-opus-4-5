-- =============================================================================
-- Deep Validation Suite: Database Setup
-- =============================================================================
-- Creates landing tables for deep validation channels (DV01-DV12).
-- Each table is a destination for one or more DV channels, allowing the
-- verification scripts to confirm end-to-end message processing.
--
-- Run against the Mirth Connect database before deploying DV channels.
-- All tables use IF NOT EXISTS for idempotent execution.
-- =============================================================================

-- DV01 (ADT Enrichment Pipeline) destination table.
-- Stores enriched patient messages with external lookup results.
CREATE TABLE IF NOT EXISTS dv_enriched_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id VARCHAR(100),
  mrn VARCHAR(50),
  event_type VARCHAR(20),
  event_desc VARCHAR(500),
  external_verified BOOLEAN DEFAULT FALSE,
  raw_hl7 MEDIUMTEXT,
  server_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DV03/DV04/DV05 (Content-Based Router) destination tables.
-- Each route receives messages matching a specific routing key.
CREATE TABLE IF NOT EXISTS dv_route_a (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_name VARCHAR(200),
  route_key VARCHAR(10),
  payload TEXT,
  server_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dv_route_b (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_name VARCHAR(200),
  route_key VARCHAR(10),
  payload TEXT,
  server_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dv_route_c (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_name VARCHAR(200),
  route_key VARCHAR(10),
  payload TEXT,
  server_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DV06 (Batch Processor) destination table.
-- Each row represents one message extracted from a batch file.
CREATE TABLE IF NOT EXISTS dv_batch_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id VARCHAR(100),
  event_type VARCHAR(20),
  batch_seq INT,
  source_file VARCHAR(255),
  server_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DV09-DV12 (4-Hop VM Chain) destination table.
-- Records the final output of the VM connector chain, including
-- the accumulated hop count and source channel/message ID trail.
CREATE TABLE IF NOT EXISTS dv_chain_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chain_id VARCHAR(100),
  hop_count INT,
  source_channel_ids TEXT,
  source_message_ids TEXT,
  payload TEXT,
  server_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Summary view: quick row count across all landing tables.
-- Usage: SELECT * FROM dv_message_summary;
CREATE OR REPLACE VIEW dv_message_summary AS
SELECT 'dv_enriched_messages' AS table_name, COUNT(*) AS row_count FROM dv_enriched_messages
UNION ALL SELECT 'dv_route_a', COUNT(*) FROM dv_route_a
UNION ALL SELECT 'dv_route_b', COUNT(*) FROM dv_route_b
UNION ALL SELECT 'dv_route_c', COUNT(*) FROM dv_route_c
UNION ALL SELECT 'dv_batch_results', COUNT(*) FROM dv_batch_results
UNION ALL SELECT 'dv_chain_results', COUNT(*) FROM dv_chain_results;
