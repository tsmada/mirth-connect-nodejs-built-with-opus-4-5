/**
 * Wall-clock timeout defense-in-depth tests
 *
 * Validates that the JavaScriptExecutor logs a warning when
 * script execution exceeds WALL_TIMEOUT_MS (default: 60000ms).
 *
 * The wall-clock check is a post-execution warning only — it does NOT abort
 * the script mid-execution. True mid-execution cancellation of blocking I/O
 * would require worker_threads (deferred).
 */

// Mock the logging module to capture warn calls.
// The warn fn is created inside the factory to avoid jest.mock hoisting issues.
const mockWarn = jest.fn();
const mockRegisterComponent = jest.fn();
jest.mock('../../../src/logging/index', () => ({
  getLogger: () => ({
    warn: mockWarn,
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    isDebugEnabled: () => false,
  }),
  registerComponent: mockRegisterComponent,
}));

import { JavaScriptExecutor, resetDefaultExecutor } from '../../../src/javascript/runtime/JavaScriptExecutor';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../src/javascript/userutil/MirthMap';

describe('Wall-clock timeout defense-in-depth', () => {
  let executor: JavaScriptExecutor;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();
    mockWarn.mockClear();

    executor = new JavaScriptExecutor();
    executor.initialize();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should not warn when script completes quickly', () => {
    const result = executor.executeRaw<number>('1 + 1');

    expect(result.success).toBe(true);
    expect(result.result).toBe(2);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('should warn when wall-clock time exceeds WALL_TIMEOUT_MS', () => {
    // Mock Date.now to simulate elapsed time > 60000ms
    let callCount = 0;
    const baseTime = 1000000;

    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // First call (startTime) returns base, subsequent calls return base + 61s
      return callCount === 1 ? baseTime : baseTime + 61000;
    });

    const result = executor.executeRaw<number>('1 + 1');

    expect(result.success).toBe(true);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Script wall-clock timeout exceeded')
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('61000ms')
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('limit: 60000ms')
    );
  });

  it('should not warn when elapsed time is just under the threshold', () => {
    // The WALL_TIMEOUT_MS constant defaults to 60000 (parsed from env at load time).
    // Simulating 59999ms — just under the 60000ms threshold — should NOT warn.
    let callCount = 0;
    const baseTime = 1000000;

    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      return callCount === 1 ? baseTime : baseTime + 59999;
    });

    const result = executor.executeRaw<number>('42');

    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('should not warn on script errors (only success path)', () => {
    // Mock Date.now to simulate slow execution
    let callCount = 0;
    const baseTime = 1000000;

    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      return callCount === 1 ? baseTime : baseTime + 120000;
    });

    const result = executor.executeRaw('throw new Error("boom")');

    expect(result.success).toBe(false);
    // Wall-clock check is only in the success path, not the error path
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
