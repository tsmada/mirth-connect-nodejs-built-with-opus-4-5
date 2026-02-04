-- Validation Suite: Database Setup Script
-- Run this before executing JDBC connector tests

CREATE DATABASE IF NOT EXISTS mirth_validation;
USE mirth_validation;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS validation_dest;
DROP TABLE IF EXISTS validation_source;

-- Source table: Records to be processed by Mirth channels
CREATE TABLE validation_source (
  id INT PRIMARY KEY AUTO_INCREMENT,
  message_content TEXT,
  message_type VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
  priority INT DEFAULT 0,
  processed BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_processed (processed),
  INDEX idx_priority (priority)
);

-- Destination table: Results from Mirth channel processing
CREATE TABLE validation_dest (
  id INT PRIMARY KEY AUTO_INCREMENT,
  source_id INT NOT NULL,
  processed_content TEXT NOT NULL,
  processing_engine VARCHAR(10) NOT NULL COMMENT 'java or node',
  status VARCHAR(20) DEFAULT 'SUCCESS',
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source (source_id),
  INDEX idx_engine (processing_engine)
);

-- Grant permissions (adjust as needed for your environment)
-- GRANT ALL PRIVILEGES ON mirth_validation.* TO 'mirth'@'localhost';
-- FLUSH PRIVILEGES;

SELECT 'Database setup complete' AS status;
