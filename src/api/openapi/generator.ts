/**
 * OpenAPI 3.1 Spec Generator
 *
 * Build-time script that generates an OpenAPI 3.1 JSON spec from
 * Zod schemas registered in the route registry.
 *
 * Usage: npx tsx src/api/openapi/generator.ts
 */

import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';
import * as fs from 'fs';
import * as path from 'path';

const generator = new OpenApiGeneratorV31(registry.definitions);

const spec = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Mirth Connect API',
    version: '3.9.0',
    description:
      'Node.js Mirth Connect REST API — compatible with Mirth Connect Administrator.\n\n' +
      'This API provides full channel management, message processing, user authentication, ' +
      'and monitoring capabilities. All endpoints (except health checks and login) require authentication.',
    license: {
      name: 'MPL-2.0',
      url: 'https://www.mozilla.org/en-US/MPL/2.0/',
    },
  },
  servers: [
    { url: 'http://localhost:8081', description: 'Local development' },
    { url: 'http://localhost:8080', description: 'Default production port' },
  ],
  tags: [
    { name: 'Health', description: 'Readiness, liveness, and startup probes (no auth required)' },
    { name: 'Users', description: 'User authentication and management' },
    { name: 'Channels', description: 'Channel CRUD operations' },
    { name: 'Engine', description: 'Channel deployment operations' },
    { name: 'Channel Status', description: 'Channel lifecycle operations (start, stop, pause, resume)' },
    { name: 'Messages', description: 'Message search, retrieval, processing, and attachments' },
  ],
});

// Ensure output directory exists
const docsDir = path.resolve(process.cwd(), 'docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

// Write JSON spec
const outputPath = path.join(docsDir, 'openapi.json');
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));

console.log(`OpenAPI 3.1 spec generated: ${outputPath}`);
console.log(`  Paths: ${Object.keys(spec.paths ?? {}).length}`);
console.log(`  Schemas: ${Object.keys(spec.components?.schemas ?? {}).length}`);
