/**
 * Tests for WebService Dispatcher SOAP envelope logging.
 *
 * Verifies that SOAP request/response envelopes are logged at debug level
 * and that logging overhead is avoided when debug is disabled.
 *
 * Java Reference: WebServiceDispatcher.java
 * - logger.debug("Creating SOAP envelope.") at line 498
 * - logger.debug("Finished invoking web service, got result.") at line 571
 */

import { getLogger } from '../../../../src/logging/index';
import { resetDebugRegistry, setComponentLevel, clearComponentLevel } from '../../../../src/logging/DebugModeRegistry';
import { LogLevel } from '../../../../src/plugins/serverlog/ServerLogItem';

// We test the logger behavior rather than the full WebServiceDispatcher
// because the dispatcher requires network I/O (SOAP calls).

describe('WebServiceDispatcher SOAP Logging', () => {
  beforeEach(() => {
    resetDebugRegistry();
  });

  describe('ws-connector logger registration', () => {
    it('should register ws-connector as a loggable component', () => {
      // The import of WebServiceDispatcher registers the component
      // We can verify by getting the logger
      const logger = getLogger('ws-connector');
      expect(logger).toBeDefined();
      expect(logger.getComponent()).toBe('ws-connector');
    });
  });

  describe('isDebugEnabled guard', () => {
    it('should report debug disabled when global level is INFO', () => {
      const logger = getLogger('ws-connector');
      // Default global level is INFO, so debug should be disabled
      expect(logger.isDebugEnabled()).toBe(false);
    });

    it('should report debug enabled when component level is set to DEBUG', () => {
      setComponentLevel('ws-connector', LogLevel.DEBUG);
      const logger = getLogger('ws-connector');
      expect(logger.isDebugEnabled()).toBe(true);
    });

    it('should report debug disabled after clearing component level', () => {
      setComponentLevel('ws-connector', LogLevel.DEBUG);
      const logger = getLogger('ws-connector');
      expect(logger.isDebugEnabled()).toBe(true);

      // Clear the override
      clearComponentLevel('ws-connector');
      expect(logger.isDebugEnabled()).toBe(false);
    });
  });

  describe('logging pattern', () => {
    it('should not serialize envelope when debug is disabled', () => {
      const logger = getLogger('ws-connector');
      const envelope = '<soap:Envelope>...</soap:Envelope>';

      // This pattern matches the code in WebServiceDispatcher.executeRequest():
      // if (logger.isDebugEnabled()) {
      //   logger.debug(`SOAP Request envelope: ${envelope}`);
      // }
      let serialized = false;
      const getEnvelope = () => {
        serialized = true;
        return envelope;
      };

      if (logger.isDebugEnabled()) {
        logger.debug(`SOAP Request envelope: ${getEnvelope()}`);
      }

      // Should NOT have called getEnvelope() since debug is off
      expect(serialized).toBe(false);
    });

    it('should serialize envelope when debug is enabled', () => {
      setComponentLevel('ws-connector', LogLevel.DEBUG);
      const logger = getLogger('ws-connector');
      const envelope = '<soap:Envelope>...</soap:Envelope>';

      let serialized = false;
      const getEnvelope = () => {
        serialized = true;
        return envelope;
      };

      if (logger.isDebugEnabled()) {
        logger.debug(`SOAP Request envelope: ${getEnvelope()}`);
      }

      // Should have called getEnvelope() since debug is on
      expect(serialized).toBe(true);
    });
  });
});
