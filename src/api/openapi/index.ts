/**
 * OpenAPI module barrel exports
 */

export { registry } from './registry.js';
export { getOpenApiSpec, mountOpenApiDocs } from './serve.js';

// Re-export all schemas for use in request validation or type inference
export * from './schemas.js';
