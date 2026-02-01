import {
  getDefaultTcpReceiverProperties,
  getDefaultTcpDispatcherProperties,
  frameMessage,
  unframeMessage,
  hasCompleteMessage,
  generateAck,
  extractControlId,
  TransmissionMode,
  ServerMode,
  ResponseMode,
  MLLP_FRAME,
} from '../../../../src/connectors/tcp/TcpConnectorProperties';

describe('TcpConnectorProperties', () => {
  describe('getDefaultTcpReceiverProperties', () => {
    it('should return default receiver properties', () => {
      const props = getDefaultTcpReceiverProperties();

      expect(props.serverMode).toBe(ServerMode.SERVER);
      expect(props.host).toBe('0.0.0.0');
      expect(props.port).toBe(6661);
      expect(props.transmissionMode).toBe(TransmissionMode.MLLP);
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.keepConnectionOpen).toBe(true);
      expect(props.maxConnections).toBe(10);
      expect(props.responseMode).toBe(ResponseMode.AUTO);
    });

    it('should return independent instances', () => {
      const props1 = getDefaultTcpReceiverProperties();
      const props2 = getDefaultTcpReceiverProperties();

      props1.port = 8080;
      expect(props2.port).toBe(6661);
    });

    it('should have MLLP frame bytes', () => {
      const props = getDefaultTcpReceiverProperties();

      expect(props.startOfMessageBytes).toEqual([MLLP_FRAME.START_BLOCK]);
      expect(props.endOfMessageBytes).toEqual([
        MLLP_FRAME.END_BLOCK,
        MLLP_FRAME.CARRIAGE_RETURN,
      ]);
    });
  });

  describe('getDefaultTcpDispatcherProperties', () => {
    it('should return default dispatcher properties', () => {
      const props = getDefaultTcpDispatcherProperties();

      expect(props.host).toBe('localhost');
      expect(props.port).toBe(6661);
      expect(props.transmissionMode).toBe(TransmissionMode.MLLP);
      expect(props.charsetEncoding).toBe('UTF-8');
      expect(props.sendTimeout).toBe(10000);
      expect(props.responseTimeout).toBe(10000);
      expect(props.keepConnectionOpen).toBe(true);
    });

    it('should return independent instances', () => {
      const props1 = getDefaultTcpDispatcherProperties();
      const props2 = getDefaultTcpDispatcherProperties();

      props1.host = 'remotehost';
      expect(props2.host).toBe('localhost');
    });
  });

  describe('frameMessage', () => {
    const startBytes = [MLLP_FRAME.START_BLOCK];
    const endBytes = [MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN];

    it('should frame message with MLLP', () => {
      const message = 'MSH|^~\\&|TEST||';
      const framed = frameMessage(
        message,
        TransmissionMode.MLLP,
        startBytes,
        endBytes
      );

      expect(framed[0]).toBe(MLLP_FRAME.START_BLOCK);
      expect(framed[framed.length - 2]).toBe(MLLP_FRAME.END_BLOCK);
      expect(framed[framed.length - 1]).toBe(MLLP_FRAME.CARRIAGE_RETURN);
      expect(framed.subarray(1, framed.length - 2).toString()).toBe(message);
    });

    it('should frame message with custom FRAME mode', () => {
      const message = 'test message';
      const customStart = [0x02]; // STX
      const customEnd = [0x03]; // ETX
      const framed = frameMessage(
        message,
        TransmissionMode.FRAME,
        customStart,
        customEnd
      );

      expect(framed[0]).toBe(0x02);
      expect(framed[framed.length - 1]).toBe(0x03);
    });

    it('should not frame message in RAW mode', () => {
      const message = 'raw message';
      const framed = frameMessage(
        message,
        TransmissionMode.RAW,
        startBytes,
        endBytes
      );

      expect(framed.toString()).toBe(message);
    });
  });

  describe('unframeMessage', () => {
    const startBytes = [MLLP_FRAME.START_BLOCK];
    const endBytes = [MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN];

    it('should unframe MLLP message', () => {
      const message = 'MSH|^~\\&|TEST||';
      const framed = Buffer.concat([
        Buffer.from([MLLP_FRAME.START_BLOCK]),
        Buffer.from(message),
        Buffer.from([MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN]),
      ]);

      const unframed = unframeMessage(
        framed,
        TransmissionMode.MLLP,
        startBytes,
        endBytes
      );

      expect(unframed).toBe(message);
    });

    it('should return null for incomplete MLLP message', () => {
      const incomplete = Buffer.from([MLLP_FRAME.START_BLOCK, 0x41, 0x42]);

      const result = unframeMessage(
        incomplete,
        TransmissionMode.MLLP,
        startBytes,
        endBytes
      );

      expect(result).toBeNull();
    });

    it('should unframe custom FRAME mode message', () => {
      const message = 'test message';
      const customStart = [0x02];
      const customEnd = [0x03];
      const framed = Buffer.concat([
        Buffer.from(customStart),
        Buffer.from(message),
        Buffer.from(customEnd),
      ]);

      const unframed = unframeMessage(
        framed,
        TransmissionMode.FRAME,
        customStart,
        customEnd
      );

      expect(unframed).toBe(message);
    });

    it('should return full content in RAW mode', () => {
      const message = 'raw message';
      const buffer = Buffer.from(message);

      const result = unframeMessage(
        buffer,
        TransmissionMode.RAW,
        startBytes,
        endBytes
      );

      expect(result).toBe(message);
    });
  });

  describe('hasCompleteMessage', () => {
    const endBytes = [MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN];

    it('should detect complete MLLP message', () => {
      const complete = Buffer.concat([
        Buffer.from([MLLP_FRAME.START_BLOCK]),
        Buffer.from('message'),
        Buffer.from([MLLP_FRAME.END_BLOCK, MLLP_FRAME.CARRIAGE_RETURN]),
      ]);

      expect(hasCompleteMessage(complete, TransmissionMode.MLLP, endBytes)).toBe(
        true
      );
    });

    it('should detect incomplete MLLP message', () => {
      const incomplete = Buffer.concat([
        Buffer.from([MLLP_FRAME.START_BLOCK]),
        Buffer.from('message'),
      ]);

      expect(
        hasCompleteMessage(incomplete, TransmissionMode.MLLP, endBytes)
      ).toBe(false);
    });

    it('should detect complete custom FRAME message', () => {
      const customEnd = [0x03];
      const complete = Buffer.concat([
        Buffer.from([0x02]),
        Buffer.from('message'),
        Buffer.from(customEnd),
      ]);

      expect(hasCompleteMessage(complete, TransmissionMode.FRAME, customEnd)).toBe(
        true
      );
    });

    it('should always return true for non-empty RAW mode', () => {
      const buffer = Buffer.from('any data');

      expect(hasCompleteMessage(buffer, TransmissionMode.RAW, endBytes)).toBe(
        true
      );
    });

    it('should return false for empty RAW buffer', () => {
      const empty = Buffer.alloc(0);

      expect(hasCompleteMessage(empty, TransmissionMode.RAW, endBytes)).toBe(
        false
      );
    });
  });

  describe('extractControlId', () => {
    it('should extract control ID from HL7 message', () => {
      const message =
        'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20240115120000||ADT^A01|12345|P|2.5\r' +
        'PID|1||123456||DOE^JOHN||19800101|M\r';

      const controlId = extractControlId(message);

      expect(controlId).toBe('12345');
    });

    it('should return null for non-HL7 message', () => {
      const message = 'This is not an HL7 message';

      const controlId = extractControlId(message);

      expect(controlId).toBeNull();
    });

    it('should return null for message without control ID field', () => {
      const message = 'MSH|^~\\&|SENDER|FACILITY|RECEIVER\r';

      const controlId = extractControlId(message);

      // MSH with fewer than 10 fields returns null
      expect(controlId).toBeNull();
    });
  });

  describe('generateAck', () => {
    it('should generate ACK with control ID', () => {
      const ack = generateAck('12345', 'AA');

      expect(ack).toContain('MSH|^~\\&|MIRTH|MIRTH|MIRTH|MIRTH|');
      expect(ack).toContain('ACK|12345|');
      expect(ack).toContain('MSA|AA|12345|');
    });

    it('should generate NAK with AE code', () => {
      const nak = generateAck('67890', 'AE');

      expect(nak).toContain('MSA|AE|67890|');
    });

    it('should default to AA code', () => {
      const ack = generateAck('11111');

      expect(ack).toContain('MSA|AA|11111|');
    });
  });

  describe('MLLP_FRAME constants', () => {
    it('should have correct values', () => {
      expect(MLLP_FRAME.START_BLOCK).toBe(0x0b);
      expect(MLLP_FRAME.END_BLOCK).toBe(0x1c);
      expect(MLLP_FRAME.CARRIAGE_RETURN).toBe(0x0d);
    });
  });

  describe('TransmissionMode enum', () => {
    it('should have correct values', () => {
      expect(TransmissionMode.MLLP).toBe('MLLP');
      expect(TransmissionMode.FRAME).toBe('FRAME');
      expect(TransmissionMode.RAW).toBe('RAW');
    });
  });

  describe('ServerMode enum', () => {
    it('should have correct values', () => {
      expect(ServerMode.SERVER).toBe('SERVER');
      expect(ServerMode.CLIENT).toBe('CLIENT');
    });
  });

  describe('ResponseMode enum', () => {
    it('should have correct values', () => {
      expect(ResponseMode.DESTINATION).toBe('DESTINATION');
      expect(ResponseMode.AUTO).toBe('AUTO');
      expect(ResponseMode.NONE).toBe('NONE');
    });
  });
});
