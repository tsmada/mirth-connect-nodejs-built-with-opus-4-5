-- Validation Suite: Cleanup Script
-- Run this after tests to reset database state

USE mirth_validation;

-- Clear test data
DELETE FROM validation_dest;
DELETE FROM validation_source;

-- Reset auto-increment counters
ALTER TABLE validation_source AUTO_INCREMENT = 1;
ALTER TABLE validation_dest AUTO_INCREMENT = 1;

-- Optionally drop the entire database
-- DROP DATABASE IF EXISTS mirth_validation;

SELECT 'Cleanup complete' AS status;
