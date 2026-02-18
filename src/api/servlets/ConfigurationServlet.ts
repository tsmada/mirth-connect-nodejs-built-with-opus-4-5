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
import { authorize } from '../middleware/authorization.js';
import {
  CONFIG_GET_SERVER_ID,
  CONFIG_GET_VERSION,
  CONFIG_GET_BUILD_DATE,
  CONFIG_GET_STATUS,
  CONFIG_GET_TIMEZONE,
  CONFIG_GET_TIME,
  CONFIG_GET_JVM,
  CONFIG_GET_ABOUT,
  CONFIG_GET_SETTINGS,
  CONFIG_SET_SETTINGS,
  CONFIG_GET_ENCRYPTION,
  CONFIG_GET_CHARSETS,
  CONFIG_GENERATE_GUID,
  CONFIG_GET_GLOBAL_SCRIPTS,
  CONFIG_SET_GLOBAL_SCRIPTS,
  CONFIG_GET_CONFIG_MAP,
  CONFIG_SET_CONFIG_MAP,
  CONFIG_GET_DB_DRIVERS,
  CONFIG_SET_DB_DRIVERS,
  CONFIG_GET_PASSWORD_REQUIREMENTS,
  CONFIG_GET_UPDATE_SETTINGS,
  CONFIG_SET_UPDATE_SETTINGS,
  CONFIG_GET_LICENSE,
  CONFIG_GET_RESOURCES,
  CONFIG_SET_RESOURCES,
  CONFIG_RELOAD_RESOURCE,
  CONFIG_GET_CHANNEL_DEPS,
  CONFIG_SET_CHANNEL_DEPS,
  CONFIG_GET_CHANNEL_TAGS,
  CONFIG_SET_CHANNEL_TAGS,
  CONFIG_GET_CHANNEL_METADATA,
  CONFIG_SET_CHANNEL_METADATA,
  CONFIG_GET_PROTOCOLS,
  CONFIG_GET_RHINO_VERSION,
  CONFIG_GET_SERVER_CONFIGURATION,
  CONFIG_SET_SERVER_CONFIGURATION,
  CONFIG_TEST_EMAIL,
} from '../middleware/operations.js';
import { ChannelController } from '../../controllers/ChannelController.js';
import { getLogger, registerComponent } from '../../logging/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');

export const configurationRouter = Router();

// Server info constants
const SERVER_VERSION = '3.9.0';
const SERVER_BUILD_DATE = '2024-01-15';

/**
 * GET /server/id
 * Get server ID
 */
configurationRouter.get('/id', authorize({ operation: CONFIG_GET_SERVER_ID }), async (_req: Request, res: Response) => {
  try {
    const serverId = await ConfigurationController.getServerId();
    res.type('text/plain').send(serverId);
  } catch (error) {
    logger.error('Get server ID error', error as Error);
    res.status(500).json({ error: 'Failed to get server ID' });
  }
});

/**
 * GET /server/version
 * Get server version
 */
configurationRouter.get('/version', authorize({ operation: CONFIG_GET_VERSION }), (_req: Request, res: Response) => {
  res.type('text/plain').send(SERVER_VERSION);
});

/**
 * GET /server/buildDate
 * Get server build date
 */
configurationRouter.get('/buildDate', authorize({ operation: CONFIG_GET_BUILD_DATE }), (_req: Request, res: Response) => {
  res.type('text/plain').send(SERVER_BUILD_DATE);
});

/**
 * GET /server/status
 * Get server status (0 = running)
 */
configurationRouter.get('/status', authorize({ operation: CONFIG_GET_STATUS }), (_req: Request, res: Response) => {
  res.sendData(0);
});

/**
 * GET /server/timezone
 * Get server timezone
 */
configurationRouter.get('/timezone', authorize({ operation: CONFIG_GET_TIMEZONE }), (_req: Request, res: Response) => {
  res.type('text/plain').send(Intl.DateTimeFormat().resolvedOptions().timeZone);
});

/**
 * GET /server/time
 * Get server time
 */
configurationRouter.get('/time', authorize({ operation: CONFIG_GET_TIME }), (_req: Request, res: Response) => {
  res.sendData({
    time: new Date().toISOString(),
    timeInMillis: Date.now(),
  });
});

/**
 * GET /server/jvm
 * Get JVM name
 */
configurationRouter.get('/jvm', authorize({ operation: CONFIG_GET_JVM }), (_req: Request, res: Response) => {
  res.type('text/plain').send(`Node.js ${process.version}`);
});

/**
 * GET /server/about
 * Get about information
 */
configurationRouter.get('/about', authorize({ operation: CONFIG_GET_ABOUT }), async (_req: Request, res: Response) => {
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
    logger.error('Get about error', error as Error);
    res.status(500).json({ error: 'Failed to get about information' });
  }
});

/**
 * GET /server/settings
 * Get server settings
 */
configurationRouter.get('/settings', authorize({ operation: CONFIG_GET_SETTINGS }), async (_req: Request, res: Response) => {
  try {
    const settings = await ConfigurationController.getServerSettings();
    res.sendData(settings);
  } catch (error) {
    logger.error('Get server settings error', error as Error);
    res.status(500).json({ error: 'Failed to get server settings' });
  }
});

/**
 * PUT /server/settings
 * Update server settings
 */
configurationRouter.put('/settings', authorize({ operation: CONFIG_SET_SETTINGS }), async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    await ConfigurationController.setServerSettings(settings);
    res.status(204).end();
  } catch (error) {
    logger.error('Set server settings error', error as Error);
    res.status(500).json({ error: 'Failed to set server settings' });
  }
});

/**
 * GET /server/encryption
 * Get encryption settings
 */
configurationRouter.get('/encryption', authorize({ operation: CONFIG_GET_ENCRYPTION }), async (_req: Request, res: Response) => {
  try {
    const settings = await ConfigurationController.getEncryptionSettings();
    res.sendData(settings);
  } catch (error) {
    logger.error('Get encryption settings error', error as Error);
    res.status(500).json({ error: 'Failed to get encryption settings' });
  }
});

/**
 * GET /server/charsets
 * Get available charset encodings
 */
configurationRouter.get('/charsets', authorize({ operation: CONFIG_GET_CHARSETS }), (_req: Request, res: Response) => {
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
configurationRouter.post('/_generateGUID', authorize({ operation: CONFIG_GENERATE_GUID }), (_req: Request, res: Response) => {
  res.type('text/plain').send(uuidv4());
});

/**
 * GET /server/globalScripts
 * Get global scripts
 */
configurationRouter.get('/globalScripts', authorize({ operation: CONFIG_GET_GLOBAL_SCRIPTS }), async (_req: Request, res: Response) => {
  try {
    const scripts = await ConfigurationController.getGlobalScripts();
    res.sendData(scripts);
  } catch (error) {
    logger.error('Get global scripts error', error as Error);
    res.status(500).json({ error: 'Failed to get global scripts' });
  }
});

/**
 * PUT /server/globalScripts
 * Set global scripts
 */
configurationRouter.put('/globalScripts', authorize({ operation: CONFIG_SET_GLOBAL_SCRIPTS }), async (req: Request, res: Response) => {
  try {
    const scripts = req.body;
    await ConfigurationController.setGlobalScripts(scripts);
    res.status(204).end();
  } catch (error) {
    logger.error('Set global scripts error', error as Error);
    res.status(500).json({ error: 'Failed to set global scripts' });
  }
});

/**
 * GET /server/configurationMap
 * Get configuration map
 */
configurationRouter.get('/configurationMap', authorize({ operation: CONFIG_GET_CONFIG_MAP }), async (_req: Request, res: Response) => {
  try {
    const configMap = await ConfigurationController.getConfigurationMap();
    res.sendData(configMap);
  } catch (error) {
    logger.error('Get configuration map error', error as Error);
    res.status(500).json({ error: 'Failed to get configuration map' });
  }
});

/**
 * PUT /server/configurationMap
 * Set configuration map
 */
configurationRouter.put('/configurationMap', authorize({ operation: CONFIG_SET_CONFIG_MAP }), async (req: Request, res: Response) => {
  try {
    const configMap = req.body;
    await ConfigurationController.setConfigurationMap(configMap);
    res.status(204).end();
  } catch (error) {
    logger.error('Set configuration map error', error as Error);
    res.status(500).json({ error: 'Failed to set configuration map' });
  }
});

/**
 * GET /server/databaseDrivers
 * Get database drivers
 */
configurationRouter.get('/databaseDrivers', authorize({ operation: CONFIG_GET_DB_DRIVERS }), async (_req: Request, res: Response) => {
  try {
    const drivers = await ConfigurationController.getDatabaseDrivers();
    res.sendData(drivers);
  } catch (error) {
    logger.error('Get database drivers error', error as Error);
    res.status(500).json({ error: 'Failed to get database drivers' });
  }
});

/**
 * PUT /server/databaseDrivers
 * Set database drivers
 */
configurationRouter.put('/databaseDrivers', authorize({ operation: CONFIG_SET_DB_DRIVERS }), async (req: Request, res: Response) => {
  try {
    const drivers = req.body;
    await ConfigurationController.setDatabaseDrivers(drivers);
    res.status(204).end();
  } catch (error) {
    logger.error('Set database drivers error', error as Error);
    res.status(500).json({ error: 'Failed to set database drivers' });
  }
});

/**
 * GET /server/passwordRequirements
 * Get password requirements
 */
configurationRouter.get('/passwordRequirements', authorize({ operation: CONFIG_GET_PASSWORD_REQUIREMENTS }), async (_req: Request, res: Response) => {
  try {
    const requirements = await ConfigurationController.getPasswordRequirements();
    res.sendData(requirements);
  } catch (error) {
    logger.error('Get password requirements error', error as Error);
    res.status(500).json({ error: 'Failed to get password requirements' });
  }
});

/**
 * GET /server/updateSettings
 * Get update settings
 */
configurationRouter.get('/updateSettings', authorize({ operation: CONFIG_GET_UPDATE_SETTINGS }), async (_req: Request, res: Response) => {
  try {
    const settings = await ConfigurationController.getUpdateSettings();
    res.sendData(settings);
  } catch (error) {
    logger.error('Get update settings error', error as Error);
    res.status(500).json({ error: 'Failed to get update settings' });
  }
});

/**
 * PUT /server/updateSettings
 * Set update settings
 */
configurationRouter.put('/updateSettings', authorize({ operation: CONFIG_SET_UPDATE_SETTINGS }), async (req: Request, res: Response) => {
  try {
    const settings = req.body;
    await ConfigurationController.setUpdateSettings(settings);
    res.status(204).end();
  } catch (error) {
    logger.error('Set update settings error', error as Error);
    res.status(500).json({ error: 'Failed to set update settings' });
  }
});

/**
 * GET /server/licenseInfo
 * Get license info
 */
configurationRouter.get('/licenseInfo', authorize({ operation: CONFIG_GET_LICENSE }), (_req: Request, res: Response) => {
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
configurationRouter.get('/resources', authorize({ operation: CONFIG_GET_RESOURCES }), async (_req: Request, res: Response) => {
  try {
    const resources = await ConfigurationController.getResources();
    res.sendData(resources);
  } catch (error) {
    logger.error('Get resources error', error as Error);
    res.status(500).json({ error: 'Failed to get resources' });
  }
});

/**
 * PUT /server/resources
 * Set resources
 */
configurationRouter.put('/resources', authorize({ operation: CONFIG_SET_RESOURCES }), async (req: Request, res: Response) => {
  try {
    const resources = req.body;
    await ConfigurationController.setResources(resources);
    res.status(204).end();
  } catch (error) {
    logger.error('Set resources error', error as Error);
    res.status(500).json({ error: 'Failed to set resources' });
  }
});

/**
 * POST /server/resources/:resourceId/_reload
 * Reload a resource
 */
configurationRouter.post('/resources/:resourceId/_reload', authorize({ operation: CONFIG_RELOAD_RESOURCE }), async (req: Request, res: Response) => {
  try {
    const resourceId = req.params.resourceId as string;
    await ConfigurationController.reloadResource(resourceId);
    res.status(204).end();
  } catch (error) {
    logger.error('Reload resource error', error as Error);
    res.status(500).json({ error: 'Failed to reload resource' });
  }
});

/**
 * GET /server/channelDependencies
 * Get channel dependencies
 */
configurationRouter.get('/channelDependencies', authorize({ operation: CONFIG_GET_CHANNEL_DEPS }), async (_req: Request, res: Response) => {
  try {
    const dependencies = await ConfigurationController.getChannelDependencies();
    res.sendData(dependencies);
  } catch (error) {
    logger.error('Get channel dependencies error', error as Error);
    res.status(500).json({ error: 'Failed to get channel dependencies' });
  }
});

/**
 * PUT /server/channelDependencies
 * Set channel dependencies
 */
configurationRouter.put('/channelDependencies', authorize({ operation: CONFIG_SET_CHANNEL_DEPS }), async (req: Request, res: Response) => {
  try {
    const dependencies = req.body;
    await ConfigurationController.setChannelDependencies(dependencies);
    res.status(204).end();
  } catch (error) {
    logger.error('Set channel dependencies error', error as Error);
    res.status(500).json({ error: 'Failed to set channel dependencies' });
  }
});

/**
 * GET /server/channelTags
 * Get channel tags
 */
configurationRouter.get('/channelTags', authorize({ operation: CONFIG_GET_CHANNEL_TAGS }), async (_req: Request, res: Response) => {
  try {
    const tags = await ConfigurationController.getChannelTags();
    res.sendData(tags);
  } catch (error) {
    logger.error('Get channel tags error', error as Error);
    res.status(500).json({ error: 'Failed to get channel tags' });
  }
});

/**
 * PUT /server/channelTags
 * Set channel tags
 */
configurationRouter.put('/channelTags', authorize({ operation: CONFIG_SET_CHANNEL_TAGS }), async (req: Request, res: Response) => {
  try {
    const tags = req.body;
    await ConfigurationController.setChannelTags(tags);
    res.status(204).end();
  } catch (error) {
    logger.error('Set channel tags error', error as Error);
    res.status(500).json({ error: 'Failed to set channel tags' });
  }
});

/**
 * GET /server/channelMetadata
 * Get channel metadata
 */
configurationRouter.get('/channelMetadata', authorize({ operation: CONFIG_GET_CHANNEL_METADATA }), async (_req: Request, res: Response) => {
  try {
    const metadata = await ConfigurationController.getChannelMetadata();
    res.sendData(metadata);
  } catch (error) {
    logger.error('Get channel metadata error', error as Error);
    res.status(500).json({ error: 'Failed to get channel metadata' });
  }
});

/**
 * PUT /server/channelMetadata
 * Set channel metadata
 */
configurationRouter.put('/channelMetadata', authorize({ operation: CONFIG_SET_CHANNEL_METADATA }), async (req: Request, res: Response) => {
  try {
    const metadata = req.body;
    await ConfigurationController.setChannelMetadata(metadata);
    res.status(204).end();
  } catch (error) {
    logger.error('Set channel metadata error', error as Error);
    res.status(500).json({ error: 'Failed to set channel metadata' });
  }
});

/**
 * GET /server/protocolsAndCipherSuites
 * Get TLS protocols and cipher suites
 */
configurationRouter.get('/protocolsAndCipherSuites', authorize({ operation: CONFIG_GET_PROTOCOLS }), (_req: Request, res: Response) => {
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
configurationRouter.get('/rhinoLanguageVersion', authorize({ operation: CONFIG_GET_RHINO_VERSION }), (_req: Request, res: Response) => {
  // Return 200 for ES6+ compatibility in Node.js
  res.sendData(200);
});

/**
 * GET /server/configuration
 * Get full server configuration (backup)
 * Aggregates all server state into a single response
 * Used by GUI "Backup Config" button
 */
configurationRouter.get('/configuration', authorize({ operation: CONFIG_GET_SERVER_CONFIGURATION }), async (_req: Request, res: Response) => {
  try {
    const [
      serverSettings,
      globalScripts,
      configMap,
      channelTags,
      channelMetadata,
      channelDependencies,
      resources,
      channels,
    ] = await Promise.all([
      ConfigurationController.getServerSettings(),
      ConfigurationController.getGlobalScripts(),
      ConfigurationController.getConfigurationMap(),
      ConfigurationController.getChannelTags(),
      ConfigurationController.getChannelMetadata(),
      ConfigurationController.getChannelDependencies(),
      ConfigurationController.getResources(),
      ChannelController.getAllChannels(),
    ]);

    const configuration = {
      serverSettings,
      globalScripts,
      configurationMap: configMap,
      channelTags,
      channelMetadata,
      channelDependencies,
      resources,
      channels,
      date: new Date().toISOString(),
      version: SERVER_VERSION,
    };

    res.sendData(configuration);
  } catch (error) {
    logger.error('Get server configuration error', error as Error);
    res.status(500).json({ error: 'Failed to get server configuration' });
  }
});

/**
 * PUT /server/configuration
 * Restore server configuration from backup
 * Used by GUI "Restore Config" button
 */
configurationRouter.put('/configuration', authorize({ operation: CONFIG_SET_SERVER_CONFIGURATION }), async (req: Request, res: Response) => {
  try {
    const configuration = req.body;

    if (!configuration) {
      res.status(400).json({ error: 'Configuration data required' });
      return;
    }

    if (configuration.serverSettings) {
      await ConfigurationController.setServerSettings(configuration.serverSettings);
    }

    if (configuration.globalScripts) {
      await ConfigurationController.setGlobalScripts(configuration.globalScripts);
    }

    if (configuration.configurationMap) {
      await ConfigurationController.setConfigurationMap(configuration.configurationMap);
    }

    if (configuration.channelTags) {
      await ConfigurationController.setChannelTags(configuration.channelTags);
    }

    if (configuration.channelMetadata) {
      await ConfigurationController.setChannelMetadata(configuration.channelMetadata);
    }

    if (configuration.channelDependencies) {
      await ConfigurationController.setChannelDependencies(configuration.channelDependencies);
    }

    if (configuration.resources) {
      await ConfigurationController.setResources(configuration.resources);
    }

    if (configuration.channels && Array.isArray(configuration.channels)) {
      for (const channel of configuration.channels) {
        const existing = await ChannelController.getChannel(channel.id);
        if (existing) {
          await ChannelController.updateChannel(channel.id, channel);
        } else {
          await ChannelController.createChannel(channel);
        }
      }
    }

    res.status(204).end();
  } catch (error) {
    logger.error('Set server configuration error', error as Error);
    res.status(500).json({ error: 'Failed to restore server configuration' });
  }
});

/**
 * POST /server/_testEmail
 * Test SMTP email settings by sending a test email
 */
configurationRouter.post('/_testEmail', authorize({ operation: CONFIG_TEST_EMAIL }), async (req: Request, res: Response) => {
  try {
    const { host, port, username, password, secure, from, to } = req.body as {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      secure?: boolean;
      from?: string;
      to?: string;
    };

    if (!host || !to) {
      res.status(400).json({ error: 'SMTP host and recipient (to) are required' });
      return;
    }

    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host,
        port: port || 25,
        secure: secure || false,
        auth: username ? { user: username, pass: password } : undefined,
      });

      await transporter.sendMail({
        from: from || 'mirth@localhost',
        to,
        subject: 'Mirth Connect Test Email',
        text: 'This is a test email from Mirth Connect.',
      });

      res.type('text/plain').send('Successfully sent test email.');
    } catch (emailError) {
      res.type('text/plain').send(`Failed to send test email: ${(emailError as Error).message}`);
    }
  } catch (error) {
    logger.error('Test email error', error as Error);
    res.status(500).json({ error: 'Failed to send test email' });
  }
});
