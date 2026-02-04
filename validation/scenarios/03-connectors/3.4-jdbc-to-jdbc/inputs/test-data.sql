-- Validation Suite: Test Data Insertion
-- Run this to populate source table with test records

USE mirth_validation;

-- Clear any existing test data
DELETE FROM validation_dest;
DELETE FROM validation_source;

-- Reset auto-increment
ALTER TABLE validation_source AUTO_INCREMENT = 1;
ALTER TABLE validation_dest AUTO_INCREMENT = 1;

-- Insert test records with various scenarios
INSERT INTO validation_source (message_content, message_type, priority) VALUES
  -- Standard JSON records
  ('{"patient": "John Doe", "mrn": "12345", "dob": "1980-01-15"}', 'ADT', 1),
  ('{"patient": "Jane Smith", "mrn": "67890", "dob": "1992-06-20"}', 'ADT', 2),

  -- Lab result records
  ('{"test": "CBC", "result": "normal", "value": 7.5}', 'ORU', 1),
  ('{"test": "BMP", "result": "abnormal", "value": 145}', 'ORU', 3),

  -- NULL handling test
  (NULL, 'NULL_TEST', 0),

  -- Special characters test
  ('Special chars: <>&''"\\/', 'SPECIAL', 0),

  -- Unicode test
  ('Unicode: cafe Mirth', 'UNICODE', 0),

  -- Large content test
  (REPEAT('Lorem ipsum dolor sit amet. ', 100), 'LARGE', 0),

  -- Empty string test
  ('', 'EMPTY', 0),

  -- Numeric edge cases
  ('{"value": 9999999999999999, "decimal": 0.00000001}', 'NUMERIC', 0);

SELECT COUNT(*) AS records_inserted FROM validation_source;
SELECT id, message_type, priority, LEFT(message_content, 50) AS content_preview
FROM validation_source
ORDER BY id;
