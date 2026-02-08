import { VersionCompatibility } from '../../../src/artifact/promotion/VersionCompatibility';
import type { EngineInfo, RhinoFeatures } from '../../../src/artifact/promotion/VersionCompatibility';

describe('VersionCompatibility', () => {
  const nodeEngine: EngineInfo = { type: 'nodejs', mirthVersion: '3.9.1', e4xSupport: true };
  const java39: EngineInfo = { type: 'java', mirthVersion: '3.9.0', e4xSupport: true };
  const java40: EngineInfo = { type: 'java', mirthVersion: '4.0.0', e4xSupport: false };
  const java38: EngineInfo = { type: 'java', mirthVersion: '3.8.0', e4xSupport: true };

  describe('checkMirthVersion', () => {
    it('should allow same version range', () => {
      const result = VersionCompatibility.checkMirthVersion('3.9.0', '3.9.1');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.blocks).toHaveLength(0);
    });

    it('should warn on cross-range versions', () => {
      const result = VersionCompatibility.checkMirthVersion('3.9.1', '4.0.0', 'ch1', 'Test Channel');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.severity).toBe('warn');
      expect(result.warnings[0]!.message).toContain('differs from target');
    });

    it('should return info for unknown version', () => {
      const result = VersionCompatibility.checkMirthVersion('2.0.0', '3.9.1');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.severity).toBe('info');
    });

    it('should allow same exact version', () => {
      const result = VersionCompatibility.checkMirthVersion('3.9.1', '3.9.1');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('checkScriptSyntax', () => {
    const noRhino: RhinoFeatures = {
      usesE4X: false,
      usesES6: false,
      usesImportPackage: false,
      usesJavaAdapter: false,
    };

    it('should block E4X scripts targeting Java 4.0+', () => {
      const features: RhinoFeatures = { ...noRhino, usesE4X: true };
      const result = VersionCompatibility.checkScriptSyntax(features, java40, 'ch1', 'My Channel');
      expect(result.compatible).toBe(false);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]!.severity).toBe('block');
      expect(result.blocks[0]!.message).toContain('E4X');
    });

    it('should allow E4X scripts targeting Java 3.9', () => {
      const features: RhinoFeatures = { ...noRhino, usesE4X: true };
      const result = VersionCompatibility.checkScriptSyntax(features, java39);
      expect(result.compatible).toBe(true);
      expect(result.blocks).toHaveLength(0);
    });

    it('should warn on ES6 scripts targeting Java 3.8.x', () => {
      const features: RhinoFeatures = { ...noRhino, usesES6: true };
      const result = VersionCompatibility.checkScriptSyntax(features, java38, 'ch1', 'My Channel');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.message).toContain('ES6');
    });

    it('should warn on importPackage targeting Node.js', () => {
      const features: RhinoFeatures = { ...noRhino, usesImportPackage: true };
      const result = VersionCompatibility.checkScriptSyntax(features, nodeEngine, 'ch1', 'My Channel');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.message).toContain('importPackage');
    });

    it('should warn on JavaAdapter targeting Node.js', () => {
      const features: RhinoFeatures = { ...noRhino, usesJavaAdapter: true };
      const result = VersionCompatibility.checkScriptSyntax(features, nodeEngine, 'ch1', 'My Channel');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.message).toContain('JavaAdapter');
    });

    it('should return no warnings for clean features', () => {
      const result = VersionCompatibility.checkScriptSyntax(noRhino, nodeEngine);
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.blocks).toHaveLength(0);
    });
  });

  describe('checkEngineType', () => {
    it('should always allow Node.js to Node.js', () => {
      const result = VersionCompatibility.checkEngineType('nodejs', 'nodejs');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should always allow Java to Node.js', () => {
      const result = VersionCompatibility.checkEngineType('java', 'nodejs');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should allow Node.js to Java with info', () => {
      const result = VersionCompatibility.checkEngineType('nodejs', 'java', 'ch1', 'My Channel');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]!.severity).toBe('info');
    });

    it('should always allow Java to Java', () => {
      const result = VersionCompatibility.checkEngineType('java', 'java');
      expect(result.compatible).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('check (combined)', () => {
    it('should combine all checks', () => {
      const result = VersionCompatibility.check(
        {
          version: '3.9.1',
          engineVersion: { exportedFrom: '3.9.1', exportedEngine: 'java' },
          rhinoFeatures: { usesE4X: true, usesES6: false, usesImportPackage: false, usesJavaAdapter: false },
        },
        java40,
        'ch1',
        'Test Channel'
      );

      // Should be blocked (E4X + Java 4.0+)
      expect(result.compatible).toBe(false);
      expect(result.blocks.length).toBeGreaterThan(0);
    });

    it('should pass when all checks are compatible', () => {
      const result = VersionCompatibility.check(
        {
          version: '3.9.0',
          engineVersion: { exportedFrom: '3.9.0', exportedEngine: 'java' },
          rhinoFeatures: { usesE4X: false, usesES6: false, usesImportPackage: false, usesJavaAdapter: false },
        },
        nodeEngine,
        'ch1',
        'Test Channel'
      );

      expect(result.compatible).toBe(true);
      expect(result.blocks).toHaveLength(0);
    });

    it('should work with minimal metadata (version only)', () => {
      const result = VersionCompatibility.check(
        { version: '3.9.1' },
        nodeEngine
      );
      expect(result.compatible).toBe(true);
    });
  });

  describe('findCompatRange', () => {
    it('should find range for known versions', () => {
      expect(VersionCompatibility.findCompatRange('3.9.0')).toEqual(['3.9.0', '3.9.1']);
      expect(VersionCompatibility.findCompatRange('3.9.1')).toEqual(['3.9.0', '3.9.1']);
      expect(VersionCompatibility.findCompatRange('4.0.0')).toEqual(['4.0.0', '4.0.1']);
      expect(VersionCompatibility.findCompatRange('4.5.2')).toEqual(['4.5.0', '4.5.2']);
    });

    it('should return null for unknown versions', () => {
      expect(VersionCompatibility.findCompatRange('2.0.0')).toBeNull();
      expect(VersionCompatibility.findCompatRange('5.0.0')).toBeNull();
      expect(VersionCompatibility.findCompatRange('3.7.0')).toBeNull();
    });

    it('should handle boundary versions', () => {
      expect(VersionCompatibility.findCompatRange('3.8.0')).toEqual(['3.8.0', '3.8.1']);
      expect(VersionCompatibility.findCompatRange('3.8.1')).toEqual(['3.8.0', '3.8.1']);
    });
  });

  describe('compareSemver', () => {
    it('should compare equal versions', () => {
      expect(VersionCompatibility.compareSemver('3.9.1', '3.9.1')).toBe(0);
    });

    it('should compare major versions', () => {
      expect(VersionCompatibility.compareSemver('4.0.0', '3.9.1')).toBe(1);
      expect(VersionCompatibility.compareSemver('3.0.0', '4.0.0')).toBe(-1);
    });

    it('should compare minor versions', () => {
      expect(VersionCompatibility.compareSemver('3.10.0', '3.9.1')).toBe(1);
      expect(VersionCompatibility.compareSemver('3.8.0', '3.9.0')).toBe(-1);
    });

    it('should compare patch versions', () => {
      expect(VersionCompatibility.compareSemver('3.9.2', '3.9.1')).toBe(1);
      expect(VersionCompatibility.compareSemver('3.9.0', '3.9.1')).toBe(-1);
    });

    it('should handle different length versions', () => {
      expect(VersionCompatibility.compareSemver('3.9', '3.9.0')).toBe(0);
      expect(VersionCompatibility.compareSemver('3.9.1', '3.9')).toBe(1);
    });
  });
});
