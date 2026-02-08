import { PromotionPipeline } from '../../../src/artifact/promotion/PromotionPipeline';
import type { PromotionConfig, PromotionRequest, ChannelInfo } from '../../../src/artifact/promotion/PromotionPipeline';
import type { DependencyGraph } from '../../../src/artifact/DependencySort';
import type { EngineInfo } from '../../../src/artifact/promotion/VersionCompatibility';
import { PromotionGate } from '../../../src/artifact/promotion/PromotionGate';
import type { ApprovalRecord } from '../../../src/artifact/promotion/PromotionGate';

const defaultConfig: PromotionConfig = {
  gitFlow: {
    model: 'environment-branches',
    branches: {
      dev: 'develop',
      staging: 'staging',
      prod: 'main',
    },
  },
  environments: ['dev', 'staging', 'prod'],
};

const testChannels: ChannelInfo[] = [
  { id: 'ch1', name: 'ADT Receiver', metadata: { version: '3.9.1' } },
  { id: 'ch2', name: 'Lab Router', metadata: { version: '3.9.1' } },
  { id: 'ch3', name: 'HL7 Sender', metadata: { version: '3.9.1' } },
];

describe('PromotionPipeline', () => {
  let pipeline: PromotionPipeline;

  beforeEach(() => {
    pipeline = new PromotionPipeline(defaultConfig);
  });

  describe('validate', () => {
    it('should allow valid promotion: dev -> staging', () => {
      const result = pipeline.validate({ sourceEnv: 'dev', targetEnv: 'staging' });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow valid promotion: staging -> prod', () => {
      const result = pipeline.validate({ sourceEnv: 'staging', targetEnv: 'prod' });
      expect(result.valid).toBe(true);
    });

    it('should allow skipping environments: dev -> prod', () => {
      const result = pipeline.validate({ sourceEnv: 'dev', targetEnv: 'prod' });
      expect(result.valid).toBe(true);
    });

    it('should reject reverse promotion: staging -> dev', () => {
      const result = pipeline.validate({ sourceEnv: 'staging', targetEnv: 'dev' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Cannot promote');
    });

    it('should reject same environment: dev -> dev', () => {
      const result = pipeline.validate({ sourceEnv: 'dev', targetEnv: 'dev' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('cannot be the same');
    });

    it('should reject unknown source environment', () => {
      const result = pipeline.validate({ sourceEnv: 'unknown', targetEnv: 'staging' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unknown source');
    });

    it('should reject unknown target environment', () => {
      const result = pipeline.validate({ sourceEnv: 'dev', targetEnv: 'unknown' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unknown target');
    });
  });

  describe('promote', () => {
    it('should successfully promote channels dev -> staging', async () => {
      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
        approvedBy: 'admin',
      };

      const result = await pipeline.promote(request, testChannels);
      expect(result.success).toBe(true);
      expect(result.channelsPromoted).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail with invalid environment ordering', async () => {
      const request: PromotionRequest = {
        sourceEnv: 'prod',
        targetEnv: 'dev',
      };

      const result = await pipeline.promote(request, testChannels);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should promote only requested channel IDs', async () => {
      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
        channelIds: ['ch1', 'ch3'],
      };

      const result = await pipeline.promote(request, testChannels);
      expect(result.success).toBe(true);
      expect(result.channelsPromoted).toHaveLength(2);
      expect(result.channelsPromoted).toContain('ch1');
      expect(result.channelsPromoted).toContain('ch3');
    });

    it('should error on missing channel IDs', async () => {
      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
        channelIds: ['ch1', 'nonexistent'],
      };

      const result = await pipeline.promote(request, testChannels);
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Channel 'nonexistent' not found");
    });

    it('should error when no channels to promote', async () => {
      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
      };

      const result = await pipeline.promote(request, []);
      expect(result.success).toBe(false);
      expect(result.errors).toContain('No channels to promote');
    });

    it('should return dry-run result without recording approval', async () => {
      const createSpy = jest.spyOn(PromotionGate, 'createApproval');
      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
        dryRun: true,
        approvedBy: 'admin',
      };

      const result = await pipeline.promote(request, testChannels);
      expect(result.success).toBe(true);
      expect(result.channelsPromoted).toHaveLength(3);
      expect(createSpy).not.toHaveBeenCalled();
      createSpy.mockRestore();
    });

    it('should sort channels by dependency graph', async () => {
      // ch1 depends on ch2, ch2 depends on ch3
      const graph: DependencyGraph = {
        nodes: ['ch1', 'ch2', 'ch3'],
        edges: new Map([
          ['ch1', ['ch2']],
          ['ch2', ['ch3']],
          ['ch3', []],
        ]),
      };

      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
      };

      const result = await pipeline.promote(request, testChannels, graph);
      expect(result.success).toBe(true);
      // ch3 first (no deps), then ch2, then ch1
      expect(result.channelsPromoted).toEqual(['ch3', 'ch2', 'ch1']);
    });

    it('should include version warnings in result', async () => {
      const channelsWithVersion: ChannelInfo[] = [
        {
          id: 'ch1',
          name: 'ADT Receiver',
          metadata: {
            version: '3.9.1',
            engineVersion: { exportedFrom: '3.9.1', exportedEngine: 'nodejs' as const },
          },
        },
      ];

      const targetEngine: EngineInfo = {
        type: 'java',
        mirthVersion: '4.0.0',
        e4xSupport: false,
      };

      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
      };

      const result = await pipeline.promote(request, channelsWithVersion, undefined, targetEngine);
      // Should have version-related warnings (cross-range + engine info)
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should block promotion on incompatible versions', async () => {
      const channelsWithE4X: ChannelInfo[] = [
        {
          id: 'ch1',
          name: 'E4X Channel',
          metadata: {
            version: '3.9.1',
            rhinoFeatures: { usesE4X: true, usesES6: false, usesImportPackage: false, usesJavaAdapter: false },
          },
        },
      ];

      const targetEngine: EngineInfo = {
        type: 'java',
        mirthVersion: '4.0.0',
        e4xSupport: false,
      };

      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
      };

      const result = await pipeline.promote(request, channelsWithE4X, undefined, targetEngine);
      expect(result.blocked).toBe(true);
      expect(result.blockReasons).toBeDefined();
      expect(result.blockReasons!.length).toBeGreaterThan(0);
    });

    it('should force bypass version blocks', async () => {
      const channelsWithE4X: ChannelInfo[] = [
        {
          id: 'ch1',
          name: 'E4X Channel',
          metadata: {
            version: '3.9.1',
            rhinoFeatures: { usesE4X: true, usesES6: false, usesImportPackage: false, usesJavaAdapter: false },
          },
        },
      ];

      const targetEngine: EngineInfo = {
        type: 'java',
        mirthVersion: '4.0.0',
        e4xSupport: false,
      };

      const request: PromotionRequest = {
        sourceEnv: 'dev',
        targetEnv: 'staging',
        force: true,
      };

      const result = await pipeline.promote(request, channelsWithE4X, undefined, targetEngine);
      expect(result.success).toBe(true);
      expect(result.blocked).toBeFalsy();
    });
  });

  describe('getNextEnvironment', () => {
    it('should return next environment', () => {
      expect(pipeline.getNextEnvironment('dev')).toBe('staging');
      expect(pipeline.getNextEnvironment('staging')).toBe('prod');
    });

    it('should return null for last environment', () => {
      expect(pipeline.getNextEnvironment('prod')).toBeNull();
    });

    it('should return null for unknown environment', () => {
      expect(pipeline.getNextEnvironment('unknown')).toBeNull();
    });
  });

  describe('isValidPromotion', () => {
    it('should allow forward promotion', () => {
      expect(pipeline.isValidPromotion('dev', 'staging')).toBe(true);
      expect(pipeline.isValidPromotion('dev', 'prod')).toBe(true);
      expect(pipeline.isValidPromotion('staging', 'prod')).toBe(true);
    });

    it('should reject backward promotion', () => {
      expect(pipeline.isValidPromotion('staging', 'dev')).toBe(false);
      expect(pipeline.isValidPromotion('prod', 'dev')).toBe(false);
      expect(pipeline.isValidPromotion('prod', 'staging')).toBe(false);
    });

    it('should reject unknown environments', () => {
      expect(pipeline.isValidPromotion('unknown', 'dev')).toBe(false);
      expect(pipeline.isValidPromotion('dev', 'unknown')).toBe(false);
    });
  });

  describe('getBranch', () => {
    it('should return configured branch for environment', () => {
      expect(pipeline.getBranch('dev')).toBe('develop');
      expect(pipeline.getBranch('staging')).toBe('staging');
      expect(pipeline.getBranch('prod')).toBe('main');
    });

    it('should fall back to env name if not configured', () => {
      expect(pipeline.getBranch('unknown')).toBe('unknown');
    });
  });
});

describe('PromotionGate', () => {
  describe('createApproval', () => {
    it('should create approval with generated id and timestamp', () => {
      const record = PromotionGate.createApproval({
        sourceEnv: 'dev',
        targetEnv: 'staging',
        channelIds: ['ch1', 'ch2'],
        approvedBy: 'admin',
        status: 'approved',
      });

      expect(record.id).toBeDefined();
      expect(record.id.length).toBeGreaterThan(0);
      expect(record.approvedAt).toBeInstanceOf(Date);
      expect(record.sourceEnv).toBe('dev');
      expect(record.targetEnv).toBe('staging');
      expect(record.status).toBe('approved');
    });
  });

  describe('getPendingApprovals', () => {
    it('should filter pending approvals for target env', () => {
      const records: ApprovalRecord[] = [
        PromotionGate.createApproval({ sourceEnv: 'dev', targetEnv: 'staging', channelIds: ['ch1'], approvedBy: 'admin', status: 'pending' }),
        PromotionGate.createApproval({ sourceEnv: 'dev', targetEnv: 'staging', channelIds: ['ch2'], approvedBy: 'admin', status: 'approved' }),
        PromotionGate.createApproval({ sourceEnv: 'staging', targetEnv: 'prod', channelIds: ['ch1'], approvedBy: 'admin', status: 'pending' }),
      ];

      const pending = PromotionGate.getPendingApprovals('staging', records);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.channelIds).toEqual(['ch1']);
    });

    it('should return empty array when no pending approvals', () => {
      const pending = PromotionGate.getPendingApprovals('staging', []);
      expect(pending).toHaveLength(0);
    });
  });

  describe('isApproved', () => {
    it('should return true when all channels are approved', () => {
      const records: ApprovalRecord[] = [
        PromotionGate.createApproval({ sourceEnv: 'dev', targetEnv: 'staging', channelIds: ['ch1', 'ch2'], approvedBy: 'admin', status: 'approved' }),
      ];

      expect(PromotionGate.isApproved('dev', 'staging', ['ch1', 'ch2'], records)).toBe(true);
    });

    it('should return false when some channels are not approved', () => {
      const records: ApprovalRecord[] = [
        PromotionGate.createApproval({ sourceEnv: 'dev', targetEnv: 'staging', channelIds: ['ch1'], approvedBy: 'admin', status: 'approved' }),
      ];

      expect(PromotionGate.isApproved('dev', 'staging', ['ch1', 'ch2'], records)).toBe(false);
    });

    it('should return false when no approved records exist', () => {
      expect(PromotionGate.isApproved('dev', 'staging', ['ch1'], [])).toBe(false);
    });

    it('should combine approvals from multiple records', () => {
      const records: ApprovalRecord[] = [
        PromotionGate.createApproval({ sourceEnv: 'dev', targetEnv: 'staging', channelIds: ['ch1'], approvedBy: 'admin', status: 'approved' }),
        PromotionGate.createApproval({ sourceEnv: 'dev', targetEnv: 'staging', channelIds: ['ch2'], approvedBy: 'admin', status: 'approved' }),
      ];

      expect(PromotionGate.isApproved('dev', 'staging', ['ch1', 'ch2'], records)).toBe(true);
    });

    it('should ignore records for different source/target', () => {
      const records: ApprovalRecord[] = [
        PromotionGate.createApproval({ sourceEnv: 'staging', targetEnv: 'prod', channelIds: ['ch1'], approvedBy: 'admin', status: 'approved' }),
      ];

      expect(PromotionGate.isApproved('dev', 'staging', ['ch1'], records)).toBe(false);
    });
  });

  describe('serialize/deserialize', () => {
    it('should round-trip approval records', () => {
      const original = PromotionGate.createApproval({
        sourceEnv: 'dev',
        targetEnv: 'staging',
        channelIds: ['ch1', 'ch2'],
        commitHash: 'abc123',
        approvedBy: 'admin',
        status: 'approved',
        notes: 'Looks good',
      });

      const serialized = PromotionGate.serialize(original);
      const deserialized = PromotionGate.deserialize(serialized);

      expect(deserialized.id).toBe(original.id);
      expect(deserialized.sourceEnv).toBe(original.sourceEnv);
      expect(deserialized.targetEnv).toBe(original.targetEnv);
      expect(deserialized.channelIds).toEqual(original.channelIds);
      expect(deserialized.commitHash).toBe(original.commitHash);
      expect(deserialized.approvedBy).toBe(original.approvedBy);
      expect(deserialized.approvedAt.getTime()).toBe(original.approvedAt.getTime());
      expect(deserialized.status).toBe(original.status);
      expect(deserialized.notes).toBe(original.notes);
    });

    it('should handle records without optional fields', () => {
      const original = PromotionGate.createApproval({
        sourceEnv: 'dev',
        targetEnv: 'staging',
        channelIds: ['ch1'],
        approvedBy: 'admin',
        status: 'pending',
      });

      const serialized = PromotionGate.serialize(original);
      const deserialized = PromotionGate.deserialize(serialized);

      expect(deserialized.commitHash).toBeUndefined();
      expect(deserialized.notes).toBeUndefined();
    });
  });
});
