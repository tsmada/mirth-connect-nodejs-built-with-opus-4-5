/**
 * Tests for the shadow cutover fix:
 * - getMirthInstance() / mirthInstance global accessor exists and is exported
 * - initializeVMRouter() visibility changed from private to public
 * - ShadowServlet imports getMirthInstance and calls completeShadowCutover
 *
 * NOTE: Full lifecycle tests (start/stop) require too many module mocks for
 * the Mirth class. Instead we verify the structural changes that fix the bug:
 * 1. getMirthInstance is exported from Mirth.ts
 * 2. initializeVMRouter is public
 * 3. ShadowServlet imports and calls getMirthInstance + completeShadowCutover
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

describe('Shadow cutover fix (structural verification)', () => {
  const srcDir = path.join(process.cwd(), 'src');
  const mirthSrc = fs.readFileSync(path.join(srcDir, 'server', 'Mirth.ts'), 'utf-8');
  const shadowServletSrc = fs.readFileSync(path.join(srcDir, 'api', 'servlets', 'ShadowServlet.ts'), 'utf-8');

  describe('Mirth.ts changes', () => {
    it('exports getMirthInstance function', () => {
      expect(mirthSrc).toContain('export function getMirthInstance()');
    });

    it('has mirthInstance module-level variable', () => {
      expect(mirthSrc).toContain('let mirthInstance: Mirth | null = null');
    });

    it('sets mirthInstance = this in start()', () => {
      // Find "mirthInstance = this" that appears before "this.running = true"
      const startIdx = mirthSrc.indexOf('mirthInstance = this');
      const runningIdx = mirthSrc.indexOf('this.running = true');
      expect(startIdx).toBeGreaterThan(-1);
      expect(runningIdx).toBeGreaterThan(-1);
      expect(startIdx).toBeLessThan(runningIdx);
    });

    it('sets mirthInstance = null in stop()', () => {
      // Find "mirthInstance = null" in the stop() method
      const stopMethodIdx = mirthSrc.indexOf('async stop()');
      const nullIdx = mirthSrc.indexOf('mirthInstance = null', stopMethodIdx);
      expect(nullIdx).toBeGreaterThan(stopMethodIdx);
    });

    it('initializeVMRouter is public (not private)', () => {
      // Should NOT contain "private initializeVMRouter"
      expect(mirthSrc).not.toContain('private initializeVMRouter');
      // Should contain the method without private prefix
      expect(mirthSrc).toMatch(/^\s+initializeVMRouter\(\): void/m);
    });

    it('completeShadowCutover calls initializeVMRouter and dataPrunerController.initialize', () => {
      // Extract the completeShadowCutover method body
      const cutoverIdx = mirthSrc.indexOf('async completeShadowCutover()');
      expect(cutoverIdx).toBeGreaterThan(-1);
      const afterCutover = mirthSrc.substring(cutoverIdx, cutoverIdx + 300);
      expect(afterCutover).toContain('this.initializeVMRouter()');
      expect(afterCutover).toContain('dataPrunerController.initialize()');
    });
  });

  describe('ShadowServlet.ts changes', () => {
    it('imports getMirthInstance', () => {
      expect(shadowServletSrc).toContain("import { getMirthInstance }");
    });

    it('calls getMirthInstance() in the promote endpoint', () => {
      expect(shadowServletSrc).toContain('getMirthInstance()');
    });

    it('calls completeShadowCutover() after full promote', () => {
      expect(shadowServletSrc).toContain('completeShadowCutover()');
    });

    it('cutover call is before D_SERVERS update', () => {
      const cutoverIdx = shadowServletSrc.indexOf('completeShadowCutover()');
      const dServersIdx = shadowServletSrc.indexOf("D_SERVERS", cutoverIdx);
      expect(cutoverIdx).toBeGreaterThan(-1);
      expect(dServersIdx).toBeGreaterThan(cutoverIdx);
    });
  });
});
