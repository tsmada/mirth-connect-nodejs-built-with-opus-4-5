/**
 * Configuration Controller
 *
 * Business logic for server configuration operations.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ServerSettings,
  EncryptionSettings,
  UpdateSettings,
  PasswordRequirements,
  DriverInfo,
  ResourceProperties,
  ChannelDependency,
  ChannelTag,
  ConfigurationProperty,
  getDefaultServerSettings,
} from '../api/models/ServerSettings.js';
import { ChannelMetadata } from '../api/models/Channel.js';
import * as MirthDao from '../db/MirthDao.js';

// In-memory storage for settings (persisted to database)
let serverSettings: ServerSettings = getDefaultServerSettings();
let serverIdCache: string | null = null;

/**
 * Configuration Controller - manages server configuration
 */
export class ConfigurationController {
  /**
   * Get server ID
   */
  static async getServerId(): Promise<string> {
    if (serverIdCache) {
      return serverIdCache;
    }

    // Try to get from database
    const storedId = await MirthDao.getConfiguration('core', 'server.id');
    if (storedId) {
      serverIdCache = storedId;
      return storedId;
    }

    // Generate new server ID
    const newId = uuidv4();
    await MirthDao.setConfiguration('core', 'server.id', newId);
    serverIdCache = newId;
    return newId;
  }

  /**
   * Get server settings
   */
  static async getServerSettings(): Promise<ServerSettings> {
    // Try to load from database
    const stored = await MirthDao.getConfiguration('core', 'server.settings');
    if (stored) {
      try {
        serverSettings = JSON.parse(stored);
      } catch {
        // Use defaults
      }
    }
    return serverSettings;
  }

  /**
   * Set server settings
   */
  static async setServerSettings(settings: ServerSettings): Promise<void> {
    serverSettings = { ...serverSettings, ...settings };
    await MirthDao.setConfiguration('core', 'server.settings', JSON.stringify(serverSettings));
  }

  /**
   * Get encryption settings
   */
  static async getEncryptionSettings(): Promise<EncryptionSettings> {
    const stored = await MirthDao.getConfiguration('core', 'encryption.settings');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return defaults
      }
    }
    return {
      encryptExport: false,
      encryptProperties: false,
      digestAlgorithm: 'SHA-256',
      encryptionAlgorithm: 'AES',
      encryptionKeyLength: 256,
    };
  }

  /**
   * Get global scripts
   */
  static async getGlobalScripts(): Promise<Record<string, string>> {
    const stored = await MirthDao.getConfiguration('core', 'global.scripts');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return defaults
      }
    }
    return {
      Deploy: '',
      Undeploy: '',
      Preprocessor: '',
      Postprocessor: '',
    };
  }

  /**
   * Set global scripts
   */
  static async setGlobalScripts(scripts: Record<string, string>): Promise<void> {
    await MirthDao.setConfiguration('core', 'global.scripts', JSON.stringify(scripts));
  }

  /**
   * Get configuration map
   */
  static async getConfigurationMap(): Promise<Record<string, ConfigurationProperty>> {
    const stored = await MirthDao.getConfiguration('core', 'configuration.map');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return empty
      }
    }
    return {};
  }

  /**
   * Set configuration map
   */
  static async setConfigurationMap(
    configMap: Record<string, ConfigurationProperty>
  ): Promise<void> {
    await MirthDao.setConfiguration('core', 'configuration.map', JSON.stringify(configMap));
  }

  /**
   * Get database drivers
   */
  static async getDatabaseDrivers(): Promise<DriverInfo[]> {
    const stored = await MirthDao.getConfiguration('core', 'database.drivers');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return defaults
      }
    }
    return [
      {
        name: 'MySQL',
        className: 'com.mysql.cj.jdbc.Driver',
        template: 'jdbc:mysql://host:port/database',
        selectLimit: 'LIMIT',
      },
      {
        name: 'PostgreSQL',
        className: 'org.postgresql.Driver',
        template: 'jdbc:postgresql://host:port/database',
        selectLimit: 'LIMIT',
      },
      {
        name: 'Oracle',
        className: 'oracle.jdbc.OracleDriver',
        template: 'jdbc:oracle:thin:@host:port:database',
        selectLimit: 'ROWNUM',
      },
      {
        name: 'SQL Server',
        className: 'com.microsoft.sqlserver.jdbc.SQLServerDriver',
        template: 'jdbc:sqlserver://host:port;databaseName=database',
        selectLimit: 'TOP',
      },
    ];
  }

  /**
   * Set database drivers
   */
  static async setDatabaseDrivers(drivers: DriverInfo[]): Promise<void> {
    await MirthDao.setConfiguration('core', 'database.drivers', JSON.stringify(drivers));
  }

  /**
   * Get password requirements
   */
  static async getPasswordRequirements(): Promise<PasswordRequirements> {
    const stored = await MirthDao.getConfiguration('core', 'password.requirements');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return defaults
      }
    }
    return {
      minLength: 8,
      minUpper: 0,
      minLower: 0,
      minNumeric: 0,
      minSpecial: 0,
      retryLimit: 3,
      lockoutPeriod: 0,
      expiration: 0,
      gracePeriod: 0,
      reusePeriod: 0,
      reuseLimit: 0,
    };
  }

  /**
   * Get update settings
   */
  static async getUpdateSettings(): Promise<UpdateSettings> {
    const stored = await MirthDao.getConfiguration('core', 'update.settings');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return defaults
      }
    }
    return {
      statsEnabled: false,
      updateEnabled: true,
    };
  }

  /**
   * Set update settings
   */
  static async setUpdateSettings(settings: UpdateSettings): Promise<void> {
    await MirthDao.setConfiguration('core', 'update.settings', JSON.stringify(settings));
  }

  /**
   * Get resources
   */
  static async getResources(): Promise<ResourceProperties[]> {
    const stored = await MirthDao.getConfiguration('core', 'resources');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return defaults
      }
    }
    return [
      {
        id: 'Default Resource',
        name: 'Default Resource',
        type: 'Directory',
        description: 'Default resource for custom libraries',
        includeWithGlobalScripts: true,
      },
    ];
  }

  /**
   * Set resources
   */
  static async setResources(resources: ResourceProperties[]): Promise<void> {
    await MirthDao.setConfiguration('core', 'resources', JSON.stringify(resources));
  }

  /**
   * Reload a resource
   */
  static async reloadResource(resourceId: string): Promise<void> {
    console.log(`Reloading resource: ${resourceId}`);
    // In a real implementation, this would reload libraries
  }

  /**
   * Get channel dependencies
   */
  static async getChannelDependencies(): Promise<ChannelDependency[]> {
    const stored = await MirthDao.getConfiguration('core', 'channel.dependencies');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return empty
      }
    }
    return [];
  }

  /**
   * Set channel dependencies
   */
  static async setChannelDependencies(dependencies: ChannelDependency[]): Promise<void> {
    await MirthDao.setConfiguration('core', 'channel.dependencies', JSON.stringify(dependencies));
  }

  /**
   * Get channel tags
   */
  static async getChannelTags(): Promise<ChannelTag[]> {
    const stored = await MirthDao.getConfiguration('core', 'channel.tags');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return empty
      }
    }
    return [];
  }

  /**
   * Set channel tags
   */
  static async setChannelTags(tags: ChannelTag[]): Promise<void> {
    await MirthDao.setConfiguration('core', 'channel.tags', JSON.stringify(tags));
  }

  /**
   * Get channel metadata
   */
  static async getChannelMetadata(): Promise<Record<string, ChannelMetadata>> {
    const stored = await MirthDao.getConfiguration('core', 'channel.metadata');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Return empty
      }
    }
    return {};
  }

  /**
   * Set channel metadata
   */
  static async setChannelMetadata(metadata: Record<string, ChannelMetadata>): Promise<void> {
    await MirthDao.setConfiguration('core', 'channel.metadata', JSON.stringify(metadata));
  }
}
