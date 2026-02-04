/**
 * Unit tests for JMS Connector Properties
 */

import {
  AcknowledgeMode,
  DeliveryMode,
  getDefaultJmsReceiverProperties,
  getDefaultJmsDispatcherProperties,
  buildDestinationPath,
  generateClientId,
  acknowledgeModeTodStompAck,
  deliveryModeToStompPersistent,
} from '../../../../src/connectors/jms/JmsConnectorProperties.js';

describe('JmsConnectorProperties', () => {
  describe('getDefaultJmsReceiverProperties', () => {
    it('should return default receiver properties', () => {
      const props = getDefaultJmsReceiverProperties();

      expect(props.useJndi).toBe(false);
      expect(props.host).toBe('localhost');
      expect(props.port).toBe(61613);
      expect(props.destinationName).toBe('');
      expect(props.topic).toBe(false);
      expect(props.selector).toBe('');
      expect(props.reconnectIntervalMillis).toBe(10000);
      expect(props.durableTopic).toBe(false);
      expect(props.acknowledgeMode).toBe(AcknowledgeMode.CLIENT);
      expect(props.prefetchCount).toBe(1);
    });

    it('should have empty connection properties by default', () => {
      const props = getDefaultJmsReceiverProperties();
      expect(props.connectionProperties).toEqual({});
    });

    it('should have empty credentials by default', () => {
      const props = getDefaultJmsReceiverProperties();
      expect(props.username).toBe('');
      expect(props.password).toBe('');
    });
  });

  describe('getDefaultJmsDispatcherProperties', () => {
    it('should return default dispatcher properties', () => {
      const props = getDefaultJmsDispatcherProperties();

      expect(props.useJndi).toBe(false);
      expect(props.host).toBe('localhost');
      expect(props.port).toBe(61613);
      expect(props.destinationName).toBe('');
      expect(props.topic).toBe(false);
      expect(props.template).toBe('${message.encodedData}');
      expect(props.deliveryMode).toBe(DeliveryMode.PERSISTENT);
      expect(props.priority).toBe(4);
      expect(props.timeToLive).toBe(0);
      expect(props.sendTimeout).toBe(30000);
    });

    it('should have empty correlation ID and reply-to by default', () => {
      const props = getDefaultJmsDispatcherProperties();
      expect(props.correlationId).toBe('');
      expect(props.replyTo).toBe('');
    });

    it('should have empty headers by default', () => {
      const props = getDefaultJmsDispatcherProperties();
      expect(props.headers).toEqual({});
    });
  });

  describe('buildDestinationPath', () => {
    it('should add /queue/ prefix for queues', () => {
      const path = buildDestinationPath('my-queue', false);
      expect(path).toBe('/queue/my-queue');
    });

    it('should add /topic/ prefix for topics', () => {
      const path = buildDestinationPath('my-topic', true);
      expect(path).toBe('/topic/my-topic');
    });

    it('should preserve existing /queue/ prefix', () => {
      const path = buildDestinationPath('/queue/existing', false);
      expect(path).toBe('/queue/existing');
    });

    it('should preserve existing /topic/ prefix', () => {
      const path = buildDestinationPath('/topic/existing', true);
      expect(path).toBe('/topic/existing');
    });

    it('should preserve /exchange/ prefix', () => {
      const path = buildDestinationPath('/exchange/amq.direct', false);
      expect(path).toBe('/exchange/amq.direct');
    });
  });

  describe('generateClientId', () => {
    it('should generate unique client IDs', () => {
      const id1 = generateClientId('channel-123', 'connector1');
      const id2 = generateClientId('channel-123', 'connector1');

      expect(id1).not.toBe(id2);
    });

    it('should include channel ID prefix', () => {
      const id = generateClientId('channel-123-abc-def', 'connector1');
      expect(id).toContain('mirth-channel-');
    });

    it('should include connector name', () => {
      const id = generateClientId('channel-123', 'MyConnector');
      expect(id).toContain('MyConnector');
    });
  });

  describe('acknowledgeModeTodStompAck', () => {
    it('should convert AUTO to "auto"', () => {
      expect(acknowledgeModeTodStompAck(AcknowledgeMode.AUTO)).toBe('auto');
    });

    it('should convert CLIENT to "client"', () => {
      expect(acknowledgeModeTodStompAck(AcknowledgeMode.CLIENT)).toBe('client');
    });

    it('should convert CLIENT_INDIVIDUAL to "client-individual"', () => {
      expect(acknowledgeModeTodStompAck(AcknowledgeMode.CLIENT_INDIVIDUAL)).toBe(
        'client-individual'
      );
    });
  });

  describe('deliveryModeToStompPersistent', () => {
    it('should convert PERSISTENT to "true"', () => {
      expect(deliveryModeToStompPersistent(DeliveryMode.PERSISTENT)).toBe('true');
    });

    it('should convert NON_PERSISTENT to "false"', () => {
      expect(deliveryModeToStompPersistent(DeliveryMode.NON_PERSISTENT)).toBe(
        'false'
      );
    });
  });
});
