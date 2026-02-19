-- =============================================================================
-- Deep Validation Suite: Database Teardown
-- =============================================================================
-- Drops all landing tables and views created by setup.sql.
-- Run after validation is complete to clean up the Mirth database.
--
-- NOTE: This does NOT drop Mirth's own per-channel tables (D_M*, D_MM*, etc.).
-- Those are managed by the engine and cleaned up when channels are undeployed.
-- =============================================================================

-- Drop the summary view first (depends on the tables).
DROP VIEW IF EXISTS dv_message_summary;

-- Drop landing tables in any order (no foreign key dependencies).
DROP TABLE IF EXISTS dv_enriched_messages;
DROP TABLE IF EXISTS dv_route_a;
DROP TABLE IF EXISTS dv_route_b;
DROP TABLE IF EXISTS dv_route_c;
DROP TABLE IF EXISTS dv_batch_results;
DROP TABLE IF EXISTS dv_chain_results;
