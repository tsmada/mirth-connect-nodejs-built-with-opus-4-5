-- =============================================================================
-- Polling Coordination Validation: Verification Queries
-- =============================================================================
-- Run these queries after the validation scenario to confirm:
--   1. No duplicate file processing (CRITICAL)
--   2. Exactly one lease per polling channel
--   3. All files processed by the same server (lease holder)
--   4. Lease holder matches the audit trail processor
-- =============================================================================

-- Check 1: No duplicate file processing (CRITICAL)
-- Should return 0 rows. Any result = FAILURE (duplicate processing detected).
SELECT
  FILE_NAME,
  COUNT(*) AS process_count,
  GROUP_CONCAT(DISTINCT SERVER_ID ORDER BY SERVER_ID) AS servers
FROM DV_POLL_AUDIT
GROUP BY FILE_NAME
HAVING COUNT(*) > 1;

-- Check 2: Lease count per channel
-- For exclusive mode: exactly 1 row per polling channel.
SELECT
  CHANNEL_ID,
  SERVER_ID,
  ACQUIRED_AT,
  RENEWED_AT,
  EXPIRES_AT
FROM D_POLLING_LEASES
ORDER BY CHANNEL_ID;

-- Check 3: Server distribution
-- In exclusive mode, all files should be processed by one server.
SELECT
  SERVER_ID,
  COUNT(*) AS files_processed
FROM DV_POLL_AUDIT
GROUP BY SERVER_ID
ORDER BY files_processed DESC;

-- Check 4: Lease holder matches audit trail processor
-- Should return 0 rows. Any result = FAILURE (lease holder != processor).
SELECT
  l.CHANNEL_ID,
  l.SERVER_ID AS lease_holder,
  a.SERVER_ID AS processor,
  COUNT(*) AS mismatched_count
FROM D_POLLING_LEASES l
JOIN DV_POLL_AUDIT a ON l.CHANNEL_ID = a.CHANNEL_ID
WHERE l.SERVER_ID != a.SERVER_ID
GROUP BY l.CHANNEL_ID, l.SERVER_ID, a.SERVER_ID;

-- Summary: total files processed
SELECT COUNT(*) AS total_processed FROM DV_POLL_AUDIT;
SELECT COUNT(DISTINCT FILE_NAME) AS unique_files FROM DV_POLL_AUDIT;
SELECT COUNT(DISTINCT SERVER_ID) AS distinct_servers FROM DV_POLL_AUDIT;
