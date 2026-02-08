import { VariableResolver } from '../../../src/artifact/VariableResolver.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('VariableResolver', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'varresolver-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Helper to create environment YAML files in tmpDir
  async function createEnvFiles(
    base?: Record<string, string>,
    envName?: string,
    envValues?: Record<string, string>
  ): Promise<string> {
    const envDir = path.join(tmpDir, 'environments');
    await fs.mkdir(envDir, { recursive: true });

    if (base) {
      const yamlContent = Object.entries(base)
        .map(([k, v]) => `${k}: "${v}"`)
        .join('\n');
      await fs.writeFile(path.join(envDir, 'base.yaml'), yamlContent);
    }

    if (envName && envValues) {
      const yamlContent = Object.entries(envValues)
        .map(([k, v]) => `${k}: "${v}"`)
        .join('\n');
      await fs.writeFile(path.join(envDir, `${envName}.yaml`), yamlContent);
    }

    return tmpDir;
  }

  // ── Basic resolution ──────────────────────────────────────────

  describe('basic variable resolution', () => {
    it('should resolve a variable from process.env', () => {
      process.env.TEST_RESOLVER_PORT = '8080';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve('port: ${TEST_RESOLVER_PORT}');
        expect(result.resolved).toBe('port: 8080');
        expect(result.unresolvedVars).toEqual([]);
      } finally {
        delete process.env.TEST_RESOLVER_PORT;
      }
    });

    it('should return input unchanged when no variables present', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('no variables here');
      expect(result.resolved).toBe('no variables here');
      expect(result.unresolvedVars).toEqual([]);
    });

    it('should handle empty string', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('');
      expect(result.resolved).toBe('');
      expect(result.unresolvedVars).toEqual([]);
    });

    it('should report unresolved variables', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('host: ${TOTALLY_UNKNOWN_VAR_XYZ}');
      expect(result.resolved).toBe('host: ${TOTALLY_UNKNOWN_VAR_XYZ}');
      expect(result.unresolvedVars).toEqual(['TOTALLY_UNKNOWN_VAR_XYZ']);
    });

    it('should resolve multiple variables in one string', () => {
      process.env.TEST_HOST = 'localhost';
      process.env.TEST_PORT = '3306';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve('jdbc:mysql://${TEST_HOST}:${TEST_PORT}/db');
        expect(result.resolved).toBe('jdbc:mysql://localhost:3306/db');
        expect(result.unresolvedVars).toEqual([]);
      } finally {
        delete process.env.TEST_HOST;
        delete process.env.TEST_PORT;
      }
    });

    it('should leave non-variable dollar signs alone', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('price is $5.00');
      expect(result.resolved).toBe('price is $5.00');
    });
  });

  // ── Inline defaults ───────────────────────────────────────────

  describe('inline default values', () => {
    it('should use inline default when variable is not set', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('port: ${MISSING_PORT:6661}');
      expect(result.resolved).toBe('port: 6661');
      expect(result.unresolvedVars).toEqual([]);
    });

    it('should prefer resolved value over inline default', () => {
      process.env.TEST_INLINE_PORT = '9999';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve('port: ${TEST_INLINE_PORT:6661}');
        expect(result.resolved).toBe('port: 9999');
      } finally {
        delete process.env.TEST_INLINE_PORT;
      }
    });

    it('should handle empty default value', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('val: ${MISSING_VAR_EMPTY:}');
      expect(result.resolved).toBe('val: ');
    });

    it('should handle default with colons in the value', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('${MISSING_URL:jdbc:mysql://localhost:3306/db}');
      expect(result.resolved).toBe('jdbc:mysql://localhost:3306/db');
    });
  });

  // ── YAML file loading ────────────────────────────────────────

  describe('environment YAML loading', () => {
    it('should resolve from base.yaml', async () => {
      const repoPath = await createEnvFiles({ DB_HOST: 'base-host', DB_PORT: '3306' });
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(repoPath);

      const result = resolver.resolve('${DB_HOST}:${DB_PORT}');
      expect(result.resolved).toBe('base-host:3306');
    });

    it('should resolve from environment-specific YAML', async () => {
      const repoPath = await createEnvFiles(
        { DB_HOST: 'base-host' },
        'prod',
        { DB_HOST: 'prod-db.internal' }
      );
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(repoPath, 'prod');

      const result = resolver.resolve('host: ${DB_HOST}');
      expect(result.resolved).toBe('host: prod-db.internal');
    });

    it('should fall back to base.yaml when env YAML does not define a var', async () => {
      const repoPath = await createEnvFiles(
        { DB_HOST: 'base-host', DB_PORT: '3306' },
        'staging',
        { DB_HOST: 'staging-host' }
      );
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(repoPath, 'staging');

      const result = resolver.resolve('${DB_HOST}:${DB_PORT}');
      expect(result.resolved).toBe('staging-host:3306');
    });

    it('should handle missing base.yaml gracefully', async () => {
      const envDir = path.join(tmpDir, 'environments');
      await fs.mkdir(envDir, { recursive: true });
      await fs.writeFile(
        path.join(envDir, 'dev.yaml'),
        'APP_NAME: "test-app"\n'
      );

      const resolver = new VariableResolver();
      await resolver.loadEnvironment(tmpDir, 'dev');

      const result = resolver.resolve('${APP_NAME}');
      expect(result.resolved).toBe('test-app');
    });

    it('should handle missing environment YAML gracefully', async () => {
      const repoPath = await createEnvFiles({ DB_HOST: 'base-host' });
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(repoPath, 'nonexistent');

      const result = resolver.resolve('${DB_HOST}');
      expect(result.resolved).toBe('base-host');
    });

    it('should handle missing environments directory gracefully', async () => {
      const resolver = new VariableResolver();
      // No environments/ directory exists in tmpDir
      await resolver.loadEnvironment(tmpDir);
      // Should not throw — just no vars loaded
      const result = resolver.resolve('${SOME_VAR:fallback}');
      expect(result.resolved).toBe('fallback');
    });
  });

  // ── Priority chain ────────────────────────────────────────────

  describe('resolution priority', () => {
    it('process.env takes highest priority over all YAML sources', async () => {
      process.env.PRIORITY_TEST = 'from-env';
      try {
        const repoPath = await createEnvFiles(
          { PRIORITY_TEST: 'from-base' },
          'prod',
          { PRIORITY_TEST: 'from-prod' }
        );
        const resolver = new VariableResolver({
          extraVariables: { PRIORITY_TEST: 'from-extra' },
        });
        await resolver.loadEnvironment(repoPath, 'prod');

        const result = resolver.resolve('${PRIORITY_TEST}');
        expect(result.resolved).toBe('from-env');
      } finally {
        delete process.env.PRIORITY_TEST;
      }
    });

    it('env YAML takes priority over base YAML', async () => {
      const repoPath = await createEnvFiles(
        { LEVEL_TEST: 'from-base' },
        'staging',
        { LEVEL_TEST: 'from-staging' }
      );
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(repoPath, 'staging');

      const result = resolver.resolve('${LEVEL_TEST}');
      expect(result.resolved).toBe('from-staging');
    });

    it('base YAML takes priority over extra variables', async () => {
      const repoPath = await createEnvFiles({ BASE_PRIO: 'from-base' });
      const resolver = new VariableResolver({
        extraVariables: { BASE_PRIO: 'from-extra' },
      });
      await resolver.loadEnvironment(repoPath);

      const result = resolver.resolve('${BASE_PRIO}');
      expect(result.resolved).toBe('from-base');
    });

    it('extra variables take priority over inline defaults', () => {
      const resolver = new VariableResolver({
        extraVariables: { EXTRA_VAR: 'from-extra' },
      });

      const result = resolver.resolve('${EXTRA_VAR:inline-default}');
      expect(result.resolved).toBe('from-extra');
    });

    it('inline default is the lowest priority', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('${TOTALLY_MISSING_ABC:last-resort}');
      expect(result.resolved).toBe('last-resort');
    });
  });

  // ── Nested variable resolution ────────────────────────────────

  describe('nested variable resolution', () => {
    it('should resolve nested variables in default values', () => {
      process.env.NESTED_HOST = 'db.example.com';
      process.env.NESTED_PORT = '5432';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve(
          '${DB_URL:jdbc:postgresql://${NESTED_HOST}:${NESTED_PORT}/mydb}'
        );
        expect(result.resolved).toBe('jdbc:postgresql://db.example.com:5432/mydb');
      } finally {
        delete process.env.NESTED_HOST;
        delete process.env.NESTED_PORT;
      }
    });

    it('should resolve nested variables in looked-up values', async () => {
      const repoPath = await createEnvFiles({
        INNER_HOST: 'inner.example.com',
        OUTER_URL: 'https://${INNER_HOST}/api',
      });
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(repoPath);

      const result = resolver.resolve('${OUTER_URL}');
      expect(result.resolved).toBe('https://inner.example.com/api');
    });

    it('should handle partially unresolved nested variables', () => {
      process.env.PARTIAL_HOST = 'known-host';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve(
          '${MISSING_CONN:http://${PARTIAL_HOST}:${UNKNOWN_NESTED_PORT}}'
        );
        expect(result.resolved).toBe('http://known-host:${UNKNOWN_NESTED_PORT}');
        expect(result.unresolvedVars).toContain('UNKNOWN_NESTED_PORT');
      } finally {
        delete process.env.PARTIAL_HOST;
      }
    });
  });

  // ── Circular reference detection ──────────────────────────────

  describe('circular reference detection', () => {
    it('should detect direct circular reference (A -> A)', async () => {
      const repoPath = await createEnvFiles({ CIRC_A: '${CIRC_A}' });
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(repoPath);

      expect(() => resolver.resolve('${CIRC_A}')).toThrow(
        /Circular variable reference detected/
      );
    });

    it('should detect indirect circular reference (A -> B -> A)', async () => {
      const repoPath = await createEnvFiles({
        CIRC_X: '${CIRC_Y}',
        CIRC_Y: '${CIRC_X}',
      });
      const resolver = new VariableResolver();
      await resolver.loadEnvironment(repoPath);

      expect(() => resolver.resolve('${CIRC_X}')).toThrow(
        /Circular variable reference detected/
      );
    });
  });

  // ── Strict mode ───────────────────────────────────────────────

  describe('strict mode', () => {
    it('should throw on unresolved variables in strict mode', () => {
      const resolver = new VariableResolver({ strict: true });
      expect(() => resolver.resolve('${STRICT_MISSING_VAR}')).toThrow(
        /Unresolved variables in strict mode: STRICT_MISSING_VAR/
      );
    });

    it('should not throw when all variables are resolved in strict mode', () => {
      process.env.STRICT_FOUND = 'ok';
      try {
        const resolver = new VariableResolver({ strict: true });
        const result = resolver.resolve('${STRICT_FOUND}');
        expect(result.resolved).toBe('ok');
      } finally {
        delete process.env.STRICT_FOUND;
      }
    });

    it('should not throw for inline defaults in strict mode (they are resolved)', () => {
      const resolver = new VariableResolver({ strict: true });
      const result = resolver.resolve('${MISSING_BUT_DEFAULTED:safe}');
      expect(result.resolved).toBe('safe');
    });
  });

  // ── resolveObject ─────────────────────────────────────────────

  describe('resolveObject', () => {
    it('should recursively resolve strings in a flat object', () => {
      process.env.OBJ_HOST = 'myhost';
      try {
        const resolver = new VariableResolver();
        const input = {
          host: '${OBJ_HOST}',
          port: 3306,
          ssl: true,
        };
        const { resolved, unresolvedVars } = resolver.resolveObject(input);
        expect(resolved).toEqual({
          host: 'myhost',
          port: 3306,
          ssl: true,
        });
        expect(unresolvedVars).toEqual([]);
      } finally {
        delete process.env.OBJ_HOST;
      }
    });

    it('should resolve strings in nested objects', () => {
      process.env.DEEP_VAL = 'found';
      try {
        const resolver = new VariableResolver();
        const input = {
          level1: {
            level2: {
              value: '${DEEP_VAL}',
            },
          },
        };
        const { resolved } = resolver.resolveObject(input);
        expect(resolved).toEqual({
          level1: {
            level2: {
              value: 'found',
            },
          },
        });
      } finally {
        delete process.env.DEEP_VAL;
      }
    });

    it('should resolve strings in arrays', () => {
      process.env.ARR_ITEM = 'resolved-item';
      try {
        const resolver = new VariableResolver();
        const input = {
          items: ['${ARR_ITEM}', 'static', '${ARR_ITEM}'],
        };
        const { resolved } = resolver.resolveObject(input);
        expect(resolved).toEqual({
          items: ['resolved-item', 'static', 'resolved-item'],
        });
      } finally {
        delete process.env.ARR_ITEM;
      }
    });

    it('should collect unresolved vars from nested structures', () => {
      const resolver = new VariableResolver();
      const input = {
        a: '${MISSING_A_123}',
        b: { c: '${MISSING_B_456}' },
      };
      const { unresolvedVars } = resolver.resolveObject(input);
      expect(unresolvedVars).toContain('MISSING_A_123');
      expect(unresolvedVars).toContain('MISSING_B_456');
    });

    it('should handle null and undefined values', () => {
      const resolver = new VariableResolver();
      const input = { a: null, b: undefined, c: 'text' };
      const { resolved } = resolver.resolveObject(input);
      expect(resolved).toEqual({ a: null, b: undefined, c: 'text' });
    });

    it('should throw in strict mode when object has unresolved vars', () => {
      const resolver = new VariableResolver({ strict: true });
      const input = { key: '${OBJ_STRICT_MISSING}' };
      expect(() => resolver.resolveObject(input)).toThrow(
        /Unresolved variables in strict mode/
      );
    });
  });

  // ── Static methods ────────────────────────────────────────────

  describe('static hasVariables', () => {
    it('should return true for strings with variables', () => {
      expect(VariableResolver.hasVariables('${VAR}')).toBe(true);
      expect(VariableResolver.hasVariables('before ${VAR} after')).toBe(true);
    });

    it('should return false for strings without variables', () => {
      expect(VariableResolver.hasVariables('no variables')).toBe(false);
      expect(VariableResolver.hasVariables('just a $ sign')).toBe(false);
      expect(VariableResolver.hasVariables('')).toBe(false);
    });
  });

  describe('static extractVariableNames', () => {
    it('should extract simple variable names', () => {
      expect(VariableResolver.extractVariableNames('${HOST}')).toEqual(['HOST']);
    });

    it('should extract multiple variable names', () => {
      const names = VariableResolver.extractVariableNames('${HOST}:${PORT}');
      expect(names).toContain('HOST');
      expect(names).toContain('PORT');
    });

    it('should extract names from default values (nested)', () => {
      const names = VariableResolver.extractVariableNames(
        '${URL:http://${HOST}:${PORT}}'
      );
      expect(names).toContain('URL');
      expect(names).toContain('HOST');
      expect(names).toContain('PORT');
    });

    it('should deduplicate names', () => {
      const names = VariableResolver.extractVariableNames('${A} and ${A}');
      expect(names).toEqual(['A']);
    });

    it('should return empty array for no variables', () => {
      expect(VariableResolver.extractVariableNames('plain text')).toEqual([]);
    });
  });

  // ── getVariableMap ────────────────────────────────────────────

  describe('getVariableMap', () => {
    it('should return all known variables with sources', async () => {
      const repoPath = await createEnvFiles(
        { SHARED: 'base-val', BASE_ONLY: 'base-only-val' },
        'dev',
        { SHARED: 'dev-val', DEV_ONLY: 'dev-only-val' }
      );
      const resolver = new VariableResolver({
        extraVariables: { EXTRA: 'extra-val' },
      });
      await resolver.loadEnvironment(repoPath, 'dev');

      const varMap = resolver.getVariableMap();

      expect(varMap.get('SHARED')).toEqual({ value: 'dev-val', source: 'environment' });
      expect(varMap.get('BASE_ONLY')).toEqual({ value: 'base-only-val', source: 'base.yaml' });
      expect(varMap.get('DEV_ONLY')).toEqual({ value: 'dev-only-val', source: 'environment' });
      expect(varMap.get('EXTRA')).toEqual({ value: 'extra-val', source: 'extra' });
    });

    it('should show process.env as highest priority source', async () => {
      process.env.VARMAP_TEST = 'from-env';
      try {
        const repoPath = await createEnvFiles({ VARMAP_TEST: 'from-base' });
        const resolver = new VariableResolver();
        await resolver.loadEnvironment(repoPath);

        const varMap = resolver.getVariableMap();
        expect(varMap.get('VARMAP_TEST')).toEqual({
          value: 'from-env',
          source: 'process.env',
        });
      } finally {
        delete process.env.VARMAP_TEST;
      }
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle unmatched opening brace', () => {
      const resolver = new VariableResolver();
      const result = resolver.resolve('broken ${VAR_UNCLOSED');
      expect(result.resolved).toBe('broken ${VAR_UNCLOSED');
    });

    it('should handle adjacent variables', () => {
      process.env.EDGE_A = 'hello';
      process.env.EDGE_B = 'world';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve('${EDGE_A}${EDGE_B}');
        expect(result.resolved).toBe('helloworld');
      } finally {
        delete process.env.EDGE_A;
        delete process.env.EDGE_B;
      }
    });

    it('should handle variable that resolves to empty string', () => {
      process.env.EDGE_EMPTY = '';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve('prefix-${EDGE_EMPTY}-suffix');
        expect(result.resolved).toBe('prefix--suffix');
      } finally {
        delete process.env.EDGE_EMPTY;
      }
    });

    it('should handle string with only a variable', () => {
      process.env.EDGE_SOLO = 'solo-value';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve('${EDGE_SOLO}');
        expect(result.resolved).toBe('solo-value');
      } finally {
        delete process.env.EDGE_SOLO;
      }
    });

    it('should not treat invalid variable names as variables', () => {
      const resolver = new VariableResolver();
      // Names starting with digits are invalid
      const result = resolver.resolve('${123_BAD}');
      expect(result.resolved).toBe('${123_BAD}');
      expect(result.unresolvedVars).toEqual([]);
    });

    it('should handle underscores in variable names', () => {
      process.env.__UNDER_SCORE__ = 'underscored';
      try {
        const resolver = new VariableResolver();
        const result = resolver.resolve('${__UNDER_SCORE__}');
        expect(result.resolved).toBe('underscored');
      } finally {
        delete process.env.__UNDER_SCORE__;
      }
    });
  });
});
