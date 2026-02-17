/**
 * Mirth Connect REST API Server
 *
 * Express-based REST API server compatible with Mirth Connect Administrator.
 * Supports both XML and JSON content types.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer, Server as HttpServer } from 'http';
import { getLogger, registerComponent } from '../logging/index.js';
import { authMiddleware, contentNegotiationMiddleware, shadowGuard } from './middleware/index.js';

registerComponent('api', 'REST API server');
const logger = getLogger('api');
import { userRouter } from './servlets/UserServlet.js';
import { channelRouter } from './servlets/ChannelServlet.js';
import { channelStatusRouter } from './servlets/ChannelStatusServlet.js';
import { channelStatisticsRouter } from './servlets/ChannelStatisticsServlet.js';
import { engineRouter } from './servlets/EngineServlet.js';
import { configurationRouter } from './servlets/ConfigurationServlet.js';
import { eventRouter } from './servlets/EventServlet.js';
import { alertRouter } from './servlets/AlertServlet.js';
import { messageRouter } from './servlets/MessageServlet.js';
import { channelGroupRouter } from './servlets/ChannelGroupServlet.js';
import { extensionRouter } from './servlets/ExtensionServlet.js';
import { databaseTaskRouter } from './servlets/DatabaseTaskServlet.js';
import { systemRouter } from './servlets/SystemServlet.js';
import { usageRouter } from './servlets/UsageServlet.js';
import { traceRouter } from './servlets/TraceServlet.js';
import { shadowRouter } from './servlets/ShadowServlet.js';
import { artifactRouter } from './servlets/ArtifactServlet.js';
import { secretsRouter } from './servlets/SecretsServlet.js';
import { loggingRouter } from './servlets/LoggingServlet.js';

// Cluster health probes and routing
import { healthRouter } from '../cluster/HealthCheck.js';
import { clusterRouter } from './servlets/ClusterServlet.js';
import { internalRouter } from '../cluster/RemoteDispatcher.js';

// Plugin routes
import { codeTemplateRouter } from '../plugins/codetemplates/index.js';
import { dataPrunerRouter } from '../plugins/datapruner/index.js';

// WebSocket handlers
import { dashboardStatusWebSocket } from '../plugins/dashboardstatus/DashboardStatusWebSocket.js';
import { serverLogWebSocket } from '../plugins/serverlog/ServerLogWebSocket.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  corsEnabled?: boolean;
  corsOrigins?: string[];
}

const DEFAULT_OPTIONS: ServerOptions = {
  port: 8080,
  host: '0.0.0.0',
  corsEnabled: true,
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : ['*'],
};

/**
 * Create and configure Express application
 */
export function createApp(options: ServerOptions = {}): Express {
  const app = express();
  const config = { ...DEFAULT_OPTIONS, ...options };

  // Security headers via helmet (CSP disabled for API-only server)
  app.use(helmet({ contentSecurityPolicy: false }));

  // General API rate limiting (configurable via MIRTH_API_RATE_LIMIT env var)
  const apiRateLimit = parseInt(process.env.MIRTH_API_RATE_LIMIT || '100', 10);
  app.use('/api', rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: apiRateLimit,
    skip: (req) => req.path.startsWith('/health'),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too Many Requests', message: 'Rate limit exceeded. Try again later.' },
  }));

  // Warn if CORS wildcard is used
  if (config.corsOrigins?.includes('*')) {
    logger.warn('CORS configured with wildcard (*). Set CORS_ORIGINS env var for production.');
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CORS wildcard (*) is not allowed in production. Set the CORS_ORIGINS environment variable.');
    }
  }

  // CORS middleware
  if (config.corsEnabled) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.get('Origin');
      if (config.corsOrigins?.includes('*') || (origin && config.corsOrigins?.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Authorization, X-Session-ID, X-Mirth-Login-Data'
      );
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'X-Session-ID');

      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  // Body parsing - support text for raw XML
  app.use(express.text({ type: ['application/xml', 'text/xml'] }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Content negotiation middleware
  app.use(contentNegotiationMiddleware());

  // Health check endpoint (no auth required) - legacy
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Cluster health probes (no auth required)
  app.use('/api/health', healthRouter);

  // Internal cluster dispatch (secured by cluster secret, not user auth)
  app.use('/api/internal', internalRouter);

  // API version endpoint (no auth required)
  app.get('/api', (_req: Request, res: Response) => {
    res.json({
      name: 'Mirth Connect API',
      version: '3.9.0',
      runtime: 'Node.js',
    });
  });

  // Public routes (no auth required)
  app.use('/api/users', userRouter);

  // Shadow mode API (auth required, but NOT guarded by shadowGuard — promote/demote must always work)
  app.use('/api/system/shadow', authMiddleware({ required: true }), shadowRouter);

  // Artifact management API (auth required, not shadow-guarded — read operations must always work)
  app.use('/api/artifacts', authMiddleware({ required: true }), artifactRouter);

  // Secrets management API (auth required, not shadow-guarded — read operations must always work)
  app.use('/api/secrets', authMiddleware({ required: true }), secretsRouter);

  // Protected routes (auth required)
  // NOTE: Route order matters! More specific routes must come BEFORE parameterized routes.
  // channelStatusRouter, channelStatisticsRouter, and engineRouter have routes like /statuses
  // which must be matched BEFORE channelRouter's /:channelId route.
  app.use('/api/channels', authMiddleware({ required: true }), shadowGuard(), channelStatusRouter);
  app.use('/api/channels', authMiddleware({ required: true }), shadowGuard(), channelStatisticsRouter);
  app.use('/api/channels', authMiddleware({ required: true }), shadowGuard(), engineRouter);
  app.use('/api/channels', authMiddleware({ required: true }), shadowGuard(), channelRouter);
  app.use('/api/channels/:channelId/messages', authMiddleware({ required: true }), shadowGuard(), messageRouter);
  app.use('/api/messages/trace', authMiddleware({ required: true }), traceRouter);
  app.use('/api/channelgroups', authMiddleware({ required: true }), shadowGuard(), channelGroupRouter);
  app.use('/api/server', authMiddleware({ required: true }), shadowGuard(), configurationRouter);
  app.use('/api/events', authMiddleware({ required: true }), eventRouter);
  app.use('/api/alerts', authMiddleware({ required: true }), shadowGuard(), alertRouter);
  app.use('/api/extensions', authMiddleware({ required: true }), shadowGuard(), extensionRouter);
  app.use('/api/databaseTasks', authMiddleware({ required: true }), databaseTaskRouter);
  app.use('/api/system', authMiddleware({ required: true }), systemRouter);
  app.use('/api/system/cluster', authMiddleware({ required: true }), clusterRouter);
  app.use('/api/system/logging', authMiddleware({ required: true }), loggingRouter);
  app.use('/api/usageData', authMiddleware({ required: true }), usageRouter);

  // Plugin routes
  app.use('/api', codeTemplateRouter);
  app.use('/api/extensions/datapruner', dataPrunerRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'The requested resource was not found',
    });
  });

  // Error handler — suppress stack traces and error details in production
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('API error', err);
    const isProd = process.env.NODE_ENV === 'production';
    res.status(500).json({
      error: 'Internal Server Error',
      message: isProd ? 'An unexpected error occurred' : err.message,
    });
  });

  return app;
}

/**
 * Start the API server with WebSocket support
 */
export async function startServer(options: ServerOptions = {}): Promise<HttpServer> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const app = createApp(options);

  // Create HTTP server (required for WebSocket attachment)
  const server = createServer(app);

  // Attach WebSocket handlers (noServer mode — they create their own WebSocketServer instances)
  dashboardStatusWebSocket.attach(server, '/ws/dashboardstatus');
  serverLogWebSocket.attach(server, '/ws/serverlog');

  // Single upgrade dispatcher to avoid multiple WebSocketServers
  // independently handling (and aborting) upgrade requests on the same socket.
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '/', `http://${request.headers.host}`);

    if (pathname === '/ws/dashboardstatus') {
      dashboardStatusWebSocket.handleUpgrade(request, socket, head);
    } else if (pathname === '/ws/serverlog') {
      serverLogWebSocket.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  return new Promise((resolve) => {
    server.listen(config.port!, config.host!, () => {
      logger.info(`Mirth Connect API server listening on http://${config.host}:${config.port}`);
      logger.info(`WebSocket endpoints available at /ws/dashboardstatus and /ws/serverlog`);
      resolve(server);
    });
  });
}

export { Express, HttpServer };
