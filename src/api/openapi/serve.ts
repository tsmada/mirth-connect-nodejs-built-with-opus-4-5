/**
 * OpenAPI Spec Serve Endpoint
 *
 * Mounts the generated OpenAPI spec at /api-docs as raw JSON.
 * In development, this can be used with external Swagger UI viewers
 * (e.g., https://editor.swagger.io or Swagger UI Docker).
 *
 * Usage: Import and call mountOpenApiDocs(app) from server setup.
 */

import { Express, Request, Response } from 'express';
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';

let cachedSpec: object | null = null;

/**
 * Generate the OpenAPI spec (cached after first call)
 */
export function getOpenApiSpec(): object {
  if (cachedSpec) {
    return cachedSpec;
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  cachedSpec = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Mirth Connect API',
      version: '3.9.0',
      description: 'Node.js Mirth Connect REST API',
    },
    servers: [{ url: '/', description: 'Current server' }],
  });

  return cachedSpec;
}

/**
 * Mount the OpenAPI spec endpoint on an Express app.
 * Only enabled in non-production environments.
 *
 * Endpoints:
 * - GET /api-docs       → JSON spec
 * - GET /api-docs/spec  → JSON spec (alias)
 */
export function mountOpenApiDocs(app: Express): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  app.get('/api-docs', (_req: Request, res: Response) => {
    res.json(getOpenApiSpec());
  });

  app.get('/api-docs/spec', (_req: Request, res: Response) => {
    res.json(getOpenApiSpec());
  });
}
