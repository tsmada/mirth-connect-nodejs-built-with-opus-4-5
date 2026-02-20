/**
 * Extension Servlet
 *
 * Handles extension/plugin management operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/ExtensionServletInterface.java
 *
 * Endpoints:
 * - GET /extensions - Get all extensions
 * - GET /extensions/connectors - Get connector metadata
 * - GET /extensions/plugins - Get plugin metadata
 * - GET /extensions/:extensionName - Get extension
 * - GET /extensions/:extensionName/enabled - Check if enabled
 * - PUT /extensions/:extensionName/enabled/:enabled - Enable/disable
 * - POST /extensions/:extensionName/_setEnabled - Enable/disable (Java Mirth POST variant)
 * - GET /extensions/:extensionName/properties - Get properties
 * - PUT /extensions/:extensionName/properties - Set properties
 * - POST /extensions/_install - Install extension (501 stub)
 * - POST /extensions/_uninstall - Uninstall extension (501 stub)
 */

import { Router, Request, Response } from 'express';
import { query, execute } from '../../db/pool.js';
import { RowDataPacket } from 'mysql2';
import { authorize } from '../middleware/authorization.js';
import {
  EXTENSION_GET,
  EXTENSION_GET_ALL,
  EXTENSION_SET_ENABLED,
  EXTENSION_GET_PROPERTIES,
  EXTENSION_SET_PROPERTIES,
} from '../middleware/operations.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const extensionRouter = Router();

// ============================================================================
// Types
// ============================================================================

interface ExtensionParams {
  extensionName: string;
}

interface EnableParams extends ExtensionParams {
  enabled: string;
}

interface PluginMetaData {
  name: string;
  author: string;
  pluginVersion: string;
  mirthVersion: string;
  url?: string;
  description?: string;
  path?: string;
  enabled: boolean;
  properties: Record<string, string>;
}

interface ConnectorMetaData extends PluginMetaData {
  type: 'source' | 'destination' | 'both';
  transportName: string;
  protocol: string;
}

type ExtensionMetaData = PluginMetaData | ConnectorMetaData;

interface ExtensionRow extends RowDataPacket {
  NAME: string;
  CATEGORY: string;
  ENABLED: number;
  PROPERTIES: string | null;
}

// ============================================================================
// Built-in Extensions
// ============================================================================

/**
 * Get built-in extensions metadata
 * These are the core plugins/connectors that come with Mirth
 */
function getBuiltInExtensions(): ExtensionMetaData[] {
  return [
    // Core Plugins
    {
      name: 'Data Pruner',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Prunes old message data from channels',
      enabled: true,
      properties: {},
    },
    {
      name: 'Message Generator',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Generates test messages for channels',
      enabled: true,
      properties: {},
    },
    {
      name: 'Server Log',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Server logging plugin',
      enabled: true,
      properties: {},
    },

    // Source Connectors
    {
      name: 'HTTP Listener',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Receives messages via HTTP/HTTPS',
      enabled: true,
      properties: {},
      type: 'source',
      transportName: 'HTTP Listener',
      protocol: 'HTTP',
    } as ConnectorMetaData,
    {
      name: 'TCP Listener',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Receives messages via TCP/MLLP',
      enabled: true,
      properties: {},
      type: 'source',
      transportName: 'TCP Listener',
      protocol: 'TCP',
    } as ConnectorMetaData,
    {
      name: 'File Reader',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Reads messages from files',
      enabled: true,
      properties: {},
      type: 'source',
      transportName: 'File Reader',
      protocol: 'File',
    } as ConnectorMetaData,
    {
      name: 'Database Reader',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Reads messages from database tables',
      enabled: true,
      properties: {},
      type: 'source',
      transportName: 'Database Reader',
      protocol: 'Database',
    } as ConnectorMetaData,

    // Destination Connectors
    {
      name: 'HTTP Sender',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Sends messages via HTTP/HTTPS',
      enabled: true,
      properties: {},
      type: 'destination',
      transportName: 'HTTP Sender',
      protocol: 'HTTP',
    } as ConnectorMetaData,
    {
      name: 'TCP Sender',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Sends messages via TCP/MLLP',
      enabled: true,
      properties: {},
      type: 'destination',
      transportName: 'TCP Sender',
      protocol: 'TCP',
    } as ConnectorMetaData,
    {
      name: 'File Writer',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Writes messages to files',
      enabled: true,
      properties: {},
      type: 'destination',
      transportName: 'File Writer',
      protocol: 'File',
    } as ConnectorMetaData,
    {
      name: 'Database Writer',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Writes messages to database tables',
      enabled: true,
      properties: {},
      type: 'destination',
      transportName: 'Database Writer',
      protocol: 'Database',
    } as ConnectorMetaData,
    {
      name: 'JavaScript Writer',
      author: 'Mirth Corporation',
      pluginVersion: '3.9.0',
      mirthVersion: '3.9.0',
      description: 'Executes JavaScript for custom processing',
      enabled: true,
      properties: {},
      type: 'destination',
      transportName: 'JavaScript Writer',
      protocol: 'JavaScript',
    } as ConnectorMetaData,
  ];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Ensure extension table exists
 */
async function ensureExtensionTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS EXTENSION (
      NAME VARCHAR(255) NOT NULL PRIMARY KEY,
      CATEGORY VARCHAR(50) NOT NULL DEFAULT 'plugin',
      ENABLED TINYINT(1) NOT NULL DEFAULT 1,
      PROPERTIES LONGTEXT
    ) ENGINE=InnoDB
  `);
}

/**
 * Get extension from database, falling back to built-in
 */
async function getExtension(name: string): Promise<ExtensionMetaData | null> {
  await ensureExtensionTable();

  // Check database for overrides
  const rows = await query<ExtensionRow>('SELECT * FROM EXTENSION WHERE NAME = :name', { name });

  // Find built-in extension
  const builtIn = getBuiltInExtensions().find((ext) => ext.name === name);

  if (!builtIn) {
    return null;
  }

  // Merge with database settings if exists
  if (rows.length > 0) {
    const row = rows[0]!;
    return {
      ...builtIn,
      enabled: row.ENABLED === 1,
      properties: row.PROPERTIES ? JSON.parse(row.PROPERTIES) : {},
    };
  }

  return builtIn;
}

/**
 * Get all extensions
 */
async function getAllExtensions(): Promise<ExtensionMetaData[]> {
  await ensureExtensionTable();

  // Get database overrides
  const rows = await query<ExtensionRow>('SELECT * FROM EXTENSION');
  const overrides = new Map<string, ExtensionRow>();
  for (const row of rows) {
    overrides.set(row.NAME, row);
  }

  // Merge built-in with overrides
  return getBuiltInExtensions().map((ext) => {
    const override = overrides.get(ext.name);
    if (override) {
      return {
        ...ext,
        enabled: override.ENABLED === 1,
        properties: override.PROPERTIES ? JSON.parse(override.PROPERTIES) : {},
      };
    }
    return ext;
  });
}

/**
 * Set extension enabled state
 */
async function setExtensionEnabled(name: string, enabled: boolean): Promise<boolean> {
  await ensureExtensionTable();

  // Check if extension exists
  const builtIn = getBuiltInExtensions().find((ext) => ext.name === name);
  if (!builtIn) {
    return false;
  }

  await execute(
    `INSERT INTO EXTENSION (NAME, CATEGORY, ENABLED, PROPERTIES)
     VALUES (:name, 'plugin', :enabled, NULL)
     ON DUPLICATE KEY UPDATE ENABLED = :enabled`,
    { name, enabled: enabled ? 1 : 0 }
  );

  return true;
}

/**
 * Get extension properties
 */
async function getExtensionProperties(name: string): Promise<Record<string, string> | null> {
  const ext = await getExtension(name);
  if (!ext) {
    return null;
  }
  return ext.properties;
}

/**
 * Set extension properties
 */
async function setExtensionProperties(
  name: string,
  properties: Record<string, string>
): Promise<boolean> {
  await ensureExtensionTable();

  // Check if extension exists
  const builtIn = getBuiltInExtensions().find((ext) => ext.name === name);
  if (!builtIn) {
    return false;
  }

  const propsJson = JSON.stringify(properties);

  await execute(
    `INSERT INTO EXTENSION (NAME, CATEGORY, ENABLED, PROPERTIES)
     VALUES (:name, 'plugin', 1, :properties)
     ON DUPLICATE KEY UPDATE PROPERTIES = :properties`,
    { name, properties: propsJson }
  );

  return true;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /extensions
 * Get all extensions
 */
extensionRouter.get(
  '/',
  authorize({ operation: EXTENSION_GET_ALL }),
  async (_req: Request, res: Response) => {
    try {
      const extensions = await getAllExtensions();
      res.sendData(extensions);
    } catch (error) {
      logger.error('Get extensions error', error as Error);
      res.status(500).json({ error: 'Failed to get extensions' });
    }
  }
);

/**
 * GET /extensions/connectors
 * Get all connector metadata (source and destination connectors)
 * Used by GUI connector type dropdown
 */
extensionRouter.get(
  '/connectors',
  authorize({ operation: EXTENSION_GET_ALL }),
  async (_req: Request, res: Response) => {
    try {
      const extensions = await getAllExtensions();
      const connectors = extensions.filter(
        (ext): ext is ConnectorMetaData => 'type' in ext && 'transportName' in ext
      );
      res.sendData(connectors);
    } catch (error) {
      logger.error('Get connectors error', error as Error);
      res.status(500).json({ error: 'Failed to get connectors' });
    }
  }
);

/**
 * GET /extensions/plugins
 * Get all plugin metadata (non-connector extensions)
 * Used by GUI plugin management tab
 */
extensionRouter.get(
  '/plugins',
  authorize({ operation: EXTENSION_GET_ALL }),
  async (_req: Request, res: Response) => {
    try {
      const extensions = await getAllExtensions();
      const plugins = extensions.filter((ext) => !('type' in ext) || !('transportName' in ext));
      res.sendData(plugins);
    } catch (error) {
      logger.error('Get plugins error', error as Error);
      res.status(500).json({ error: 'Failed to get plugins' });
    }
  }
);

/**
 * POST /extensions/_install
 * Install extension (not supported in Node.js — returns 501)
 * Java Mirth installs JAR-based plugins; Node.js has built-in connectors only.
 */
extensionRouter.post(
  '/_install',
  authorize({ operation: EXTENSION_SET_ENABLED }),
  (_req: Request, res: Response) => {
    res.status(501).json({ error: 'Extension installation is not supported in Node.js Mirth' });
  }
);

/**
 * POST /extensions/_uninstall
 * Uninstall extension (not supported in Node.js — returns 501)
 */
extensionRouter.post(
  '/_uninstall',
  authorize({ operation: EXTENSION_SET_ENABLED }),
  (_req: Request, res: Response) => {
    res.status(501).json({ error: 'Extension uninstallation is not supported in Node.js Mirth' });
  }
);

/**
 * GET /extensions/:extensionName
 * Get extension by name
 */
extensionRouter.get(
  '/:extensionName',
  authorize({ operation: EXTENSION_GET }),
  async (req: Request, res: Response) => {
    try {
      const { extensionName } = req.params as unknown as ExtensionParams;
      const extension = await getExtension(decodeURIComponent(extensionName));

      if (!extension) {
        res.status(404).json({ error: 'Extension not found' });
        return;
      }

      res.sendData(extension);
    } catch (error) {
      logger.error('Get extension error', error as Error);
      res.status(500).json({ error: 'Failed to get extension' });
    }
  }
);

/**
 * GET /extensions/:extensionName/enabled
 * Check if extension is enabled (returns boolean)
 */
extensionRouter.get(
  '/:extensionName/enabled',
  authorize({ operation: EXTENSION_GET }),
  async (req: Request, res: Response) => {
    try {
      const extensionName = decodeURIComponent(req.params.extensionName as string);
      const extension = await getExtension(extensionName);

      if (!extension) {
        res.status(404).json({ error: 'Extension not found' });
        return;
      }

      res.sendData(extension.enabled);
    } catch (error) {
      logger.error('Get extension enabled error', error as Error);
      res.status(500).json({ error: 'Failed to check extension enabled' });
    }
  }
);

/**
 * PUT /extensions/:extensionName/enabled/:enabled
 * Enable or disable extension
 */
extensionRouter.put(
  '/:extensionName/enabled/:enabled',
  authorize({ operation: EXTENSION_SET_ENABLED }),
  async (req: Request, res: Response) => {
    try {
      const { extensionName, enabled } = req.params as unknown as EnableParams;
      const isEnabled = enabled === 'true';

      const success = await setExtensionEnabled(decodeURIComponent(extensionName), isEnabled);

      if (!success) {
        res.status(404).json({ error: 'Extension not found' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Set extension enabled error', error as Error);
      res.status(500).json({ error: 'Failed to set extension enabled' });
    }
  }
);

/**
 * POST /extensions/:extensionName/_setEnabled
 * Enable or disable extension (POST variant matching Java Mirth)
 * Java Mirth uses POST with body parameter, not PUT with path parameter
 */
extensionRouter.post(
  '/:extensionName/_setEnabled',
  authorize({ operation: EXTENSION_SET_ENABLED }),
  async (req: Request, res: Response) => {
    try {
      const extensionName = decodeURIComponent(req.params.extensionName as string);
      const enabled =
        req.body?.enabled === 'true' || req.body?.enabled === true || req.query.enabled === 'true';

      const success = await setExtensionEnabled(extensionName, enabled);

      if (!success) {
        res.status(404).json({ error: 'Extension not found' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Set extension enabled POST error', error as Error);
      res.status(500).json({ error: 'Failed to set extension enabled' });
    }
  }
);

/**
 * GET /extensions/:extensionName/properties
 * Get extension properties
 */
extensionRouter.get(
  '/:extensionName/properties',
  authorize({ operation: EXTENSION_GET_PROPERTIES }),
  async (req: Request, res: Response) => {
    try {
      const { extensionName } = req.params as unknown as ExtensionParams;
      const properties = await getExtensionProperties(decodeURIComponent(extensionName));

      if (properties === null) {
        res.status(404).json({ error: 'Extension not found' });
        return;
      }

      res.sendData(properties);
    } catch (error) {
      logger.error('Get extension properties error', error as Error);
      res.status(500).json({ error: 'Failed to get extension properties' });
    }
  }
);

/**
 * PUT /extensions/:extensionName/properties
 * Set extension properties
 */
extensionRouter.put(
  '/:extensionName/properties',
  authorize({ operation: EXTENSION_SET_PROPERTIES }),
  async (req: Request, res: Response) => {
    try {
      const { extensionName } = req.params as unknown as ExtensionParams;
      const properties = req.body as Record<string, string>;

      const success = await setExtensionProperties(decodeURIComponent(extensionName), properties);

      if (!success) {
        res.status(404).json({ error: 'Extension not found' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      logger.error('Set extension properties error', error as Error);
      res.status(500).json({ error: 'Failed to set extension properties' });
    }
  }
);
