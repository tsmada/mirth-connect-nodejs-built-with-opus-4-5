/**
 * Git-backed artifact management — decompose, assemble, diff, sync, promote, and deploy channel configurations.
 */

// Core decomposer/assembler
export * from './types.js';
export { decompose, toFileTree } from './ChannelDecomposer.js';
export { assemble } from './ChannelAssembler.js';
export { SensitiveDataDetector } from './SensitiveDataDetector.js';

// Environment variable resolution
export { VariableResolver } from './VariableResolver.js';

// Structural diff
export { ChannelDiff } from './ChannelDiff.js';

// Dependency sorting
export { DependencySort } from './DependencySort.js';

// Git integration
export * from './git/index.js';

// Promotion pipeline
export * from './promotion/index.js';

// Controller
export { ArtifactController } from './ArtifactController.js';

// DAO
export { ArtifactDao } from './ArtifactDao.js';
