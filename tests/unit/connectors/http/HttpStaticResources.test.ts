/**
 * Tests for HTTP static resource serving in HttpReceiver.
 *
 * Java: HttpReceiver.StaticResourceHandler inner class handles:
 * - FILE: Serve a single file at a specific context path
 * - DIRECTORY: Serve files from a directory (one level deep, no subdirectories)
 * - CUSTOM: Return inline string content with a specified content type
 *
 * Static resources are registered BEFORE the catch-all message handler,
 * so they take precedence for GET requests matching their context paths.
 * Non-GET requests fall through to the message handler.
 */

import { HttpReceiver } from '../../../../src/connectors/http/HttpReceiver';
import { HttpStaticResource } from '../../../../src/connectors/http/HttpConnectorProperties';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import http from 'http';

function makeRequest(
  port: number,
  urlPath: string,
  method: string = 'GET',
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function getPort(receiver: HttpReceiver): number {
  const server = receiver.getServer();
  const address = server?.address();
  return typeof address === 'object' && address ? address.port : 0;
}

describe('HttpReceiver Static Resources', () => {
  let receiver: HttpReceiver;
  let tmpDir: string;

  beforeEach(() => {
    // Create temp directory for file-based tests
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirth-http-static-'));
  });

  afterEach(async () => {
    if (receiver && receiver.isRunning()) {
      await receiver.stop();
    }
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('CUSTOM resource type', () => {
    it('should serve inline content at the context path', async () => {
      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/health',
          resourceType: 'CUSTOM',
          value: 'OK',
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      const res = await makeRequest(port, '/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('OK');
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('should serve JSON content with correct content type', async () => {
      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/api/status',
          resourceType: 'CUSTOM',
          value: '{"status":"running","version":"1.0"}',
          contentType: 'application/json',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      const res = await makeRequest(port, '/api/status');
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('{"status":"running","version":"1.0"}');
      expect(res.headers['content-type']).toContain('application/json');
    });
  });

  describe('FILE resource type', () => {
    it('should serve a single file at the context path', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'Hello from file');

      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/test.txt',
          resourceType: 'FILE',
          value: filePath,
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      const res = await makeRequest(port, '/test.txt');
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('Hello from file');
    });

    it('should return 404 for a non-existent file', async () => {
      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/missing.txt',
          resourceType: 'FILE',
          value: path.join(tmpDir, 'nonexistent.txt'),
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      const res = await makeRequest(port, '/missing.txt');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DIRECTORY resource type', () => {
    it('should serve files from a directory', async () => {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html>Hello</html>');
      fs.writeFileSync(path.join(tmpDir, 'style.css'), 'body { color: red; }');

      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/static',
          resourceType: 'DIRECTORY',
          value: tmpDir,
          contentType: 'text/html',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      const htmlRes = await makeRequest(port, '/static/index.html');
      expect(htmlRes.statusCode).toBe(200);
      expect(htmlRes.body).toBe('<html>Hello</html>');

      const cssRes = await makeRequest(port, '/static/style.css');
      expect(cssRes.statusCode).toBe(200);
      expect(cssRes.body).toBe('body { color: red; }');
    });

    it('should fall through for non-existent files in directory', async () => {
      fs.writeFileSync(path.join(tmpDir, 'exists.txt'), 'I exist');

      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/files',
          resourceType: 'DIRECTORY',
          value: tmpDir,
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      // Non-existent file falls through to the message handler.
      // Without a channel attached, the message handler returns 500.
      // Java: file not found -> servletResponse.reset(); return; (falls through to RequestHandler)
      const res = await makeRequest(port, '/files/nope.txt');
      // The key assertion: it did NOT serve static content (body != file content)
      expect(res.body).not.toContain('I exist');
      // Falls through to message handler (500 without channel, or handled by channel)
      expect(res.statusCode).not.toBe(200);
    });

    it('should not serve subdirectories (Java: one level deep only)', async () => {
      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'deep.txt'), 'deep');

      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/assets',
          resourceType: 'DIRECTORY',
          value: tmpDir,
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      // Java: if childPath contains "/", pass to the next request handler
      // Without a channel, the message handler returns 500 — but the key point
      // is the static resource handler did NOT serve the subdirectory file.
      const res = await makeRequest(port, '/assets/sub/deep.txt');
      expect(res.body).not.toBe('deep');
      expect(res.statusCode).not.toBe(200);
    });
  });

  describe('route ordering', () => {
    it('should only serve static resources for GET requests', async () => {
      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/health',
          resourceType: 'CUSTOM',
          value: 'OK',
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      // GET should hit static resource
      const getRes = await makeRequest(port, '/health', 'GET');
      expect(getRes.statusCode).toBe(200);
      expect(getRes.body).toBe('OK');

      // POST should fall through to message handler (which will 500 without a channel)
      // Java: non-GET requests skip static resources and go to RequestHandler
      const postRes = await makeRequest(port, '/health', 'POST');
      expect(postRes.statusCode).toBe(500);
    });
  });

  describe('context path normalization', () => {
    it('should normalize context paths with missing leading slash', async () => {
      const staticResources: HttpStaticResource[] = [
        {
          contextPath: 'health', // Missing leading slash
          resourceType: 'CUSTOM',
          value: 'OK',
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      const res = await makeRequest(port, '/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('OK');
    });

    it('should normalize context paths with trailing slash', async () => {
      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/health/',
          resourceType: 'CUSTOM',
          value: 'OK',
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      const res = await makeRequest(port, '/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('OK');
    });
  });

  describe('base context path integration', () => {
    it('should prepend connector contextPath to resource contextPath', async () => {
      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/status',
          resourceType: 'CUSTOM',
          value: 'OK',
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          contextPath: '/api',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      // Should be accessible at /api/status (base + resource)
      const res = await makeRequest(port, '/api/status');
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('OK');

      // Should NOT be accessible at /status alone
      const bareRes = await makeRequest(port, '/status');
      expect(bareRes.statusCode).toBe(404);
    });
  });

  describe('multiple static resources', () => {
    it('should serve multiple resources at different paths', async () => {
      const filePath = path.join(tmpDir, 'logo.png');
      fs.writeFileSync(filePath, 'fake-png-data');

      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/health',
          resourceType: 'CUSTOM',
          value: 'OK',
          contentType: 'text/plain',
        },
        {
          contextPath: '/logo.png',
          resourceType: 'FILE',
          value: filePath,
          contentType: 'image/png',
        },
        {
          contextPath: '/version',
          resourceType: 'CUSTOM',
          value: '{"version":"3.9.1"}',
          contentType: 'application/json',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Static Test',
        properties: {
          port: 0,
          host: '127.0.0.1',
          staticResources,
        },
      });

      await receiver.start();
      const port = getPort(receiver);

      const healthRes = await makeRequest(port, '/health');
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.body).toBe('OK');

      const logoRes = await makeRequest(port, '/logo.png');
      expect(logoRes.statusCode).toBe(200);
      expect(logoRes.body).toBe('fake-png-data');

      const versionRes = await makeRequest(port, '/version');
      expect(versionRes.statusCode).toBe(200);
      expect(versionRes.body).toBe('{"version":"3.9.1"}');
    });
  });

  describe('HttpStaticResource property parsing', () => {
    it('should store static resources in receiver properties', () => {
      const staticResources: HttpStaticResource[] = [
        {
          contextPath: '/css',
          resourceType: 'DIRECTORY',
          value: '/opt/mirth/static/css',
          contentType: 'text/css',
        },
        {
          contextPath: '/health',
          resourceType: 'CUSTOM',
          value: 'OK',
          contentType: 'text/plain',
        },
      ];

      receiver = new HttpReceiver({
        name: 'Test',
        properties: { staticResources },
      });

      const props = receiver.getProperties();
      expect(props.staticResources).toHaveLength(2);
      expect(props.staticResources![0]!.contextPath).toBe('/css');
      expect(props.staticResources![0]!.resourceType).toBe('DIRECTORY');
      expect(props.staticResources![1]!.resourceType).toBe('CUSTOM');
    });

    it('should default to empty array', () => {
      receiver = new HttpReceiver({ name: 'Test' });
      const props = receiver.getProperties();
      expect(props.staticResources).toEqual([]);
    });
  });
});
