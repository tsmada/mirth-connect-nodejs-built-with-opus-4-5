/**
 * Mirth Connect REST API Server
 *
 * Express-based REST API server compatible with Mirth Connect Administrator.
 * Supports both XML and JSON content types.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { authMiddleware, contentNegotiationMiddleware } from './middleware/index.js';
import { userRouter } from './servlets/UserServlet.js';
import { channelRouter } from './servlets/ChannelServlet.js';
import { channelStatusRouter } from './servlets/ChannelStatusServlet.js';
import { engineRouter } from './servlets/EngineServlet.js';
import { configurationRouter } from './servlets/ConfigurationServlet.js';

// Plugin routes
import { codeTemplateRouter } from '../plugins/codetemplates/index.js';
import { dataPrunerRouter } from '../plugins/datapruner/index.js';

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
  app.use('/api/channels', authMiddleware({ required: true }), channelRouter);
  app.use('/api/channels', authMiddleware({ required: true }), channelStatusRouter);
  app.use('/api/channels', authMiddleware({ required: true }), engineRouter);
  app.use('/api/server', authMiddleware({ required: true }), configurationRouter);

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
 * Start the API server
 */
export async function startServer(options: ServerOptions = {}): Promise<ReturnType<Express['listen']>> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const app = createApp(options);

  return new Promise((resolve) => {
    const server = app.listen(config.port!, config.host!, () => {
      console.log(`Mirth Connect API server listening on http://${config.host}:${config.port}`);
      resolve(server);
    });
  });
}

export { Express };
