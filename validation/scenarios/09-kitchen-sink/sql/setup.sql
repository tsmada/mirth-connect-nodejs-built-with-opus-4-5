CREATE TABLE IF NOT EXISTS ks_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  data TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ks_audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  routed_from VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ks_batch_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ks_code_table (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  value VARCHAR(255) NOT NULL,
  category VARCHAR(50) DEFAULT 'DEFAULT'
) ENGINE=InnoDB;

INSERT IGNORE INTO ks_code_table (name, value, category) VALUES
  ('ADT_A01', 'Patient Admit', 'EVENT_TYPE'),
  ('ADT_A02', 'Patient Transfer', 'EVENT_TYPE'),
  ('ADT_A03', 'Patient Discharge', 'EVENT_TYPE'),
  ('M', 'Male', 'GENDER'),
  ('F', 'Female', 'GENDER'),
  ('WBC', 'White Blood Cell Count', 'LAB_CODE'),
  ('RBC', 'Red Blood Cell Count', 'LAB_CODE'),
  ('HGB', 'Hemoglobin', 'LAB_CODE'),
  ('PLT', 'Platelet Count', 'LAB_CODE'),
  ('GLU', 'Glucose', 'LAB_CODE');