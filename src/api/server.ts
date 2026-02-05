/**
 * Mirth Connect REST API Server
 *
 * Express-based REST API server compatible with Mirth Connect Administrator.
 * Supports both XML and JSON content types.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { authMiddleware, contentNegotiationMiddleware } from './middleware/index.js';
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
  corsOrigins: ['*'],
};

/**
 * Create and configure Express application
 */
export function createApp(options: ServerOptions = {}): Express {
  const app = express();
  const config = { ...DEFAULT_OPTIONS, ...options };

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

  // Health check endpoint (no auth required)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

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

  // Protected routes (auth required)
  // NOTE: Route order matters! More specific routes must come BEFORE parameterized routes.
  // channelStatusRouter, channelStatisticsRouter, and engineRouter have routes like /statuses
  // which must be matched BEFORE channelRouter's /:channelId route.
  app.use('/api/channels', authMiddleware({ required: true }), channelStatusRouter);
  app.use('/api/channels', authMiddleware({ required: true }), channelStatisticsRouter);
  app.use('/api/channels', authMiddleware({ required: true }), engineRouter);
  app.use('/api/channels', authMiddleware({ required: true }), channelRouter);
  app.use('/api/channels/:channelId/messages', authMiddleware({ required: true }), messageRouter);
  app.use('/api/channelgroups', authMiddleware({ required: true }), channelGroupRouter);
  app.use('/api/server', authMiddleware({ required: true }), configurationRouter);
  app.use('/api/events', authMiddleware({ required: true }), eventRouter);
  app.use('/api/alerts', authMiddleware({ required: true }), alertRouter);
  app.use('/api/extensions', authMiddleware({ required: true }), extensionRouter);
  app.use('/api/databaseTasks', authMiddleware({ required: true }), databaseTaskRouter);
  app.use('/api/system', authMiddleware({ required: true }), systemRouter);
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

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API Error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
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

  // Attach WebSocket handlers
  dashboardStatusWebSocket.attach(server, '/ws/dashboardstatus');
  serverLogWebSocket.attach(server, '/ws/serverlog');

  return new Promise((resolve) => {
    server.listen(config.port!, config.host!, () => {
      console.log(`Mirth Connect API server listening on http://${config.host}:${config.port}`);
      console.log(`WebSocket endpoints available at /ws/dashboardstatus and /ws/serverlog`);
      resolve(server);
    });
  });
}

export { Express, HttpServer };
