/**
 * Jest test setup file
 *
 * Runs before all tests to configure the test environment.
 */

// Increase timeout for integration tests
jest.setTimeout(30000);

// Mock console.warn to reduce noise in tests (but allow errors)
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});
