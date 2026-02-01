/**
 * Configuration Servlet
 *
 * Handles server configuration operations.
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/client/core/api/servlets/ConfigurationServletInterface.java
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { LicenseInfo } from '../models/ServerSettings.js';
import { ConfigurationController } from '../../controllers/ConfigurationController.js';

export const configurationRouter = Router();

// Route param types
interface ResourceParams {
  resourceId: string;
}

// Server info constants
const SERVER_VERSION = '3.9.0';
const SERVER_BUILD_DATE = '2024-01-15';

/**
 * GET /server/id
 * Get server ID
 */
configurationRouter.get('/id', async (_req: Request, res: Response) => {
  try {
    const serverId = await ConfigurationController.getServerId();
    res.type('text/plain').send(serverId);
  } catch (error) {
    console.error('Get server ID error:', error);
    res.status(500).json({ error: 'Failed to get server ID' });
  }
});

/**
 * GET /server/version
 * Get server version
 */
configurationRouter.get('/version', (_req: Request, res: Response) => {
  res.type('text/plain').send(SERVER_VERSION);
});

/**
 * GET /server/buildDate
 * Get server build date
 */
configurationRouter.get('/buildDate', (_req: Request, res: Response) => {
  res.type('text/plain').send(SERVER_BUILD_DATE);
});

/**
 * GET /server/status
 * Get server status (0 = running)
 */
configurationRouter.get('/status', (_req: Request, res: Response) => {
  res.sendData(0);
});

/**
 * GET /server/timezone
 * Get server timezone
 */
configurationRouter.get('/timezone', (_req: Request, res: Response) => {
  res.type('text/plain').send(Intl.DateTimeFormat().resolvedOptions().timeZone);
});

/**
 * GET /server/time
 * Get server time
 */
configurationRouter.get('/time', (_req: Request, res: Response) => {
  res.sendData({
    time: new Date().toISOString(),
    timeInMillis: Date.now(),
  });
});

/**
 * GET /server/jvm
 * Get JVM name
 */
configurationRouter.get('/jvm', (_req: Request, res: Response) => {
  res.type('text/plain').send(`Node.js ${process.version}`);
});

/**
 * GET /server/about
 * Get about information
 */
configurationRouter.get('/about', async (_req: Request, res: Response) => {
  try {
    const about = {
      name: 'Mirth Connect',
      version: SERVER_VERSION,
      date: SERVER_BUILD_DATE,
      database: 'MySQL',
      'database-version': '8.0',
      runtime: 'Node.js',
      'runtime-version': process.version,
      platform: process.platform,
      arch: process.arch,
    };
    res.sendData(about);
  } catch (error) {
    console.error('Get about error:', error);
    res.status(500).json({ error: 'Failed to get about information' });
  }
});

/**
 * GET /server/settings
 * Get server settings
 */
configurationRouter.get('/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await ConfigurationController.getServerSettings();
    res.sendData(settings);
  } catch (error) {
    console.error('Get server settings error:', error);
    res.status(500).json({ error: 'Failed to get server settings' });
  }
});

/**
 * PUT /server/settings
 * Update server settings
 */
configurationRouter.put('/settings', async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    await ConfigurationController.setServerSettings(settings);
    res.status(204).end();
  } catch (error) {
    console.error('Set server settings error:', error);
    res.status(500).json({ error: 'Failed to set server settings' });
  }
});

/**
 * GET /server/encryption
 * Get encryption settings
 */
configurationRouter.get('/encryption', async (_req: Request, res: Response) => {
  try {
    const settings = await ConfigurationController.getEncryptionSettings();
    res.sendData(settings);
  } catch (error) {
    console.error('Get encryption settings error:', error);
    res.status(500).json({ error: 'Failed to get encryption settings' });
  }
});

/**
 * GET /server/charsets
 * Get available charset encodings
 */
configurationRouter.get('/charsets', (_req: Request, res: Response) => {
  const charsets = [
    'UTF-8',
    'UTF-16',
    'UTF-16BE',
    'UTF-16LE',
    'US-ASCII',
    'ISO-8859-1',
    'windows-1252',
  ];
  res.sendData(charsets);
});

/**
 * POST /server/_generateGUID
 * Generate a GUID
 */
configurationRouter.post('/_generateGUID', (_req: Request, res: Response) => {
  res.type('text/plain').send(uuidv4());
});

/**
 * GET /server/globalScripts
 * Get global scripts
 */
configurationRouter.get('/globalScripts', async (_req: Request, res: Response) => {
  try {
    const scripts = await ConfigurationController.getGlobalScripts();
    res.sendData(scripts);
  } catch (error) {
    console.error('Get global scripts error:', error);
    res.status(500).json({ error: 'Failed to get global scripts' });
  }
});

/**
 * PUT /server/globalScripts
 * Set global scripts
 */
configurationRouter.put('/globalScripts', async (req: Request, res: Response) => {
  try {
    const scripts = req.body;
    await ConfigurationController.setGlobalScripts(scripts);
    res.status(204).end();
  } catch (error) {
    console.error('Set global scripts error:', error);
    res.status(500).json({ error: 'Failed to set global scripts' });
  }
});

/**
 * GET /server/configurationMap
 * Get configuration map
 */
configurationRouter.get('/configurationMap', async (_req: Request, res: Response) => {
  try {
    const configMap = await ConfigurationController.getConfigurationMap();
    res.sendData(configMap);
  } catch (error) {
    console.error('Get configuration map error:', error);
    res.status(500).json({ error: 'Failed to get configuration map' });
  }
});

/**
 * PUT /server/configurationMap
 * Set configuration map
 */
configurationRouter.put('/configurationMap', async (req: Request, res: Response) => {
  try {
    const configMap = req.body;
    await ConfigurationController.setConfigurationMap(configMap);
    res.status(204).end();
  } catch (error) {
    console.error('Set configuration map error:', error);
    res.status(500).json({ error: 'Failed to set configuration map' });
  }
});

/**
 * GET /server/databaseDrivers
 * Get database drivers
 */
configurationRouter.get('/databaseDrivers', async (_req: Request, res: Response) => {
  try {
    const drivers = await ConfigurationController.getDatabaseDrivers();
    res.sendData(drivers);
  } catch (error) {
    console.error('Get database drivers error:', error);
    res.status(500).json({ error: 'Failed to get database drivers' });
  }
});

/**
 * PUT /server/databaseDrivers
 * Set database drivers
 */
configurationRouter.put('/databaseDrivers', async (req: Request, res: Response) => {
  try {
    const drivers = req.body;
    await ConfigurationController.setDatabaseDrivers(drivers);
    res.status(204).end();
  } catch (error) {
    console.error('Set database drivers error:', error);
    res.status(500).json({ error: 'Failed to set database drivers' });
  }
});

/**
 * GET /server/passwordRequirements
 * Get password requirements
 */
configurationRouter.get('/passwordRequirements', async (_req: Request, res: Response) => {
  try {
    const requirements = await ConfigurationController.getPasswordRequirements();
    res.sendData(requirements);
  } catch (error) {
    console.error('Get password requirements error:', error);
    res.status(500).json({ error: 'Failed to get password requirements' });
  }
});

/**
 * GET /server/updateSettings
 * Get update settings
 */
configurationRouter.get('/updateSettings', async (_req: Request, res: Response) => {
  try {
    const settings = await ConfigurationController.getUpdateSettings();
    res.sendData(settings);
  } catch (error) {
    console.error('Get update settings error:', error);
    res.status(500).json({ error: 'Failed to get update settings' });
  }
});

/**
 * PUT /server/updateSettings
 * Set update settings
 */
configurationRouter.put('/updateSettings', async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    await ConfigurationController.setUpdateSettings(settings);
    res.status(204).end();
  } catch (error) {
    console.error('Set update settings error:', error);
    res.status(500).json({ error: 'Failed to set update settings' });
  }
});

/**
 * GET /server/licenseInfo
 * Get license info
 */
configurationRouter.get('/licenseInfo', (_req: Request, res: Response) => {
  const licenseInfo: LicenseInfo = {
    activated: true,
    company: 'Open Source',
    type: 'Community Edition',
  };
  res.sendData(licenseInfo);
});

/**
 * GET /server/resources
 * Get resources
 */
configurationRouter.get('/resources', async (_req: Request, res: Response) => {
  try {
    const resources = await ConfigurationController.getResources();
    res.sendData(resources);
  } catch (error) {
    console.error('Get resources error:', error);
    res.status(500).json({ error: 'Failed to get resources' });
  }
});

/**
 * PUT /server/resources
 * Set resources
 */
configurationRouter.put('/resources', async (req: Request, res: Response) => {
  try {
    const resources = req.body;
    await ConfigurationController.setResources(resources);
    res.status(204).end();
  } catch (error) {
    console.error('Set resources error:', error);
    res.status(500).json({ error: 'Failed to set resources' });
  }
});

/**
 * POST /server/resources/:resourceId/_reload
 * Reload a resource
 */
configurationRouter.post('/resources/:resourceId/_reload', async (req: Request<ResourceParams>, res: Response) => {
  try {
    const { resourceId } = req.params;
    await ConfigurationController.reloadResource(resourceId);
    res.status(204).end();
  } catch (error) {
    console.error('Reload resource error:', error);
    res.status(500).json({ error: 'Failed to reload resource' });
  }
});

/**
 * GET /server/channelDependencies
 * Get channel dependencies
 */
configurationRouter.get('/channelDependencies', async (_req: Request, res: Response) => {
  try {
    const dependencies = await ConfigurationController.getChannelDependencies();
    res.sendData(dependencies);
  } catch (error) {
    console.error('Get channel dependencies error:', error);
    res.status(500).json({ error: 'Failed to get channel dependencies' });
  }
});

/**
 * PUT /server/channelDependencies
 * Set channel dependencies
 */
configurationRouter.put('/channelDependencies', async (req: Request, res: Response) => {
  try {
    const dependencies = req.body;
    await ConfigurationController.setChannelDependencies(dependencies);
    res.status(204).end();
  } catch (error) {
    console.error('Set channel dependencies error:', error);
    res.status(500).json({ error: 'Failed to set channel dependencies' });
  }
});

/**
 * GET /server/channelTags
 * Get channel tags
 */
configurationRouter.get('/channelTags', async (_req: Request, res: Response) => {
  try {
    const tags = await ConfigurationController.getChannelTags();
    res.sendData(tags);
  } catch (error) {
    console.error('Get channel tags error:', error);
    res.status(500).json({ error: 'Failed to get channel tags' });
  }
});

/**
 * PUT /server/channelTags
 * Set channel tags
 */
configurationRouter.put('/channelTags', async (req: Request, res: Response) => {
  try {
    const tags = req.body;
    await ConfigurationController.setChannelTags(tags);
    res.status(204).end();
  } catch (error) {
    console.error('Set channel tags error:', error);
    res.status(500).json({ error: 'Failed to set channel tags' });
  }
});

/**
 * GET /server/channelMetadata
 * Get channel metadata
 */
configurationRouter.get('/channelMetadata', async (_req: Request, res: Response) => {
  try {
    const metadata = await ConfigurationController.getChannelMetadata();
    res.sendData(metadata);
  } catch (error) {
    console.error('Get channel metadata error:', error);
    res.status(500).json({ error: 'Failed to get channel metadata' });
  }
});

/**
 * PUT /server/channelMetadata
 * Set channel metadata
 */
configurationRouter.put('/channelMetadata', async (req: Request, res: Response) => {
  try {
    const metadata = req.body;
    await ConfigurationController.setChannelMetadata(metadata);
    res.status(204).end();
  } catch (error) {
    console.error('Set channel metadata error:', error);
    res.status(500).json({ error: 'Failed to set channel metadata' });
  }
});

/**
 * GET /server/protocolsAndCipherSuites
 * Get TLS protocols and cipher suites
 */
configurationRouter.get('/protocolsAndCipherSuites', (_req: Request, res: Response) => {
  const protocols: Record<string, string[]> = {
    enabledProtocols: ['TLSv1.2', 'TLSv1.3'],
    supportedProtocols: ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
    enabledCipherSuites: [],
    supportedCipherSuites: [],
  };
  res.sendData(protocols);
});

/**
 * GET /server/rhinoLanguageVersion
 * Get Rhino language version (returns ES6 equivalent)
 */
configurationRouter.get('/rhinoLanguageVersion', (_req: Request, res: Response) => {
  // Return 200 for ES6+ compatibility in Node.js
  res.sendData(200);
});
