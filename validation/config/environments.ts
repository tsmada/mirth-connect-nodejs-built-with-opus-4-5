import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export interface MirthEndpoint {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  mllpPort: number;
  httpTestPort: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface ValidationConfig {
  timeout: number;
  retryCount: number;
  retryDelay: number;
}

export interface Environment {
  java: MirthEndpoint;
  node: MirthEndpoint;
  database: DatabaseConfig;
  validation: ValidationConfig;
}

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || defaultValue!;
}

function getEnvVarInt(name: string, defaultValue?: number): number {
  const value = process.env[name];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ? parseInt(value, 10) : defaultValue!;
}

export function loadEnvironment(): Environment {
  return {
    java: {
      name: 'Java Mirth Connect 3.9',
      baseUrl: getEnvVar('JAVA_MIRTH_URL', 'http://localhost:8080'),
      username: getEnvVar('JAVA_MIRTH_USER', 'admin'),
      password: getEnvVar('JAVA_MIRTH_PASS', 'admin'),
      mllpPort: getEnvVarInt('MLLP_TEST_PORT_JAVA', 6661),
      httpTestPort: getEnvVarInt('HTTP_TEST_PORT_JAVA', 8082),
    },
    node: {
      name: 'Node.js Mirth Connect',
      baseUrl: getEnvVar('NODE_MIRTH_URL', 'http://localhost:8081'),
      username: getEnvVar('NODE_MIRTH_USER', 'admin'),
      password: getEnvVar('NODE_MIRTH_PASS', 'admin'),
      mllpPort: getEnvVarInt('MLLP_TEST_PORT_NODE', 6662),
      httpTestPort: getEnvVarInt('HTTP_TEST_PORT_NODE', 8083),
    },
    database: {
      host: getEnvVar('DB_HOST', 'localhost'),
      port: getEnvVarInt('DB_PORT', 3306),
      database: getEnvVar('DB_NAME', 'mirthdb'),
      user: getEnvVar('DB_USER', 'mirth'),
      password: getEnvVar('DB_PASSWORD', 'mirth'),
    },
    validation: {
      timeout: getEnvVarInt('VALIDATION_TIMEOUT', 30000),
      retryCount: getEnvVarInt('VALIDATION_RETRY_COUNT', 3),
      retryDelay: getEnvVarInt('VALIDATION_RETRY_DELAY', 1000),
    },
  };
}

// Export default environment
export const environment = loadEnvironment();
