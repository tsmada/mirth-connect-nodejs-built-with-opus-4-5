/**
 * Channel artifact management — decompose, assemble, and diff channel configurations.
 */

export * from './types.js';
export { decompose, toFileTree } from './ChannelDecomposer.js';
export { assemble } from './ChannelAssembler.js';
export { SensitiveDataDetector } from './SensitiveDataDetector.js';
