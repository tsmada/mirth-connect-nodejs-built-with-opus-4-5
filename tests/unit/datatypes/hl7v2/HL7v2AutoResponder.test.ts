import { HL7v2AutoResponder } from '../../../../src/datatypes/hl7v2/HL7v2AutoResponder.js';
import { DefaultAutoResponder } from '../../../../src/donkey/message/DefaultAutoResponder.js';
import { Status } from '../../../../src/model/Status.js';

/**
 * Standard HL7v2 test message — no MSH.15 set (defaults to AL behavior).
 * Fields: MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20260101120000||ADT^A01|MSG001|P|2.5
 */
const TEST_MSG = 'MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20260101120000||ADT^A01|MSG001|P|2.5\rPID|||12345||DOE^JOHN';

/**
 * Build an HL7 message with a specific MSH.15 value.
 *
 * MSH field layout (pipe-separated, 0-based index):
 *   0: MSH   1: ^~\\&   2: SENDING   3: FACILITY   4: RECEIVING   5: FACILITY
 *   6: timestamp   7: security   8: ADT^A01   9: MSG001   10: P   11: 2.5
 *   12: seqNum   13: continuation   14: MSH.15 (acceptAckType)
 */
function buildMsgWithMSH15(acceptAckType: string): string {
  return `MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20260101120000||ADT^A01|MSG001|P|2.5|||${acceptAckType}\rPID|||12345||DOE^JOHN`;
}

describe('HL7v2AutoResponder', () => {
  let responder: HL7v2AutoResponder;

  beforeEach(() => {
    responder = new HL7v2AutoResponder();
  });

  // ─── MSH.15 = AL (Always) ──────────────────────────────────────

  describe('MSH.15 = AL (Always)', () => {
    const msg = buildMsgWithMSH15('AL');

    it('generates ACK for SENT status', () => {
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toContain('MSH|');
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });

    it('generates ACK for ERROR status', () => {
      const response = responder.getResponse(msg, null, Status.ERROR);
      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getMessage()).toContain('MSA|AE|MSG001');
    });

    it('generates ACK for FILTERED status', () => {
      const response = responder.getResponse(msg, null, Status.FILTERED);
      expect(response.getStatus()).toBe(Status.FILTERED);
      expect(response.getMessage()).toContain('MSA|AR|MSG001');
    });

    it('generates ACK for QUEUED status', () => {
      const response = responder.getResponse(msg, null, Status.QUEUED);
      expect(response.getStatus()).toBe(Status.QUEUED);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });

    it('generates ACK for TRANSFORMED status', () => {
      const response = responder.getResponse(msg, null, Status.TRANSFORMED);
      expect(response.getStatus()).toBe(Status.TRANSFORMED);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });
  });

  // ─── MSH.15 = NE (Never) ──────────────────────────────────────

  describe('MSH.15 = NE (Never)', () => {
    const msg = buildMsgWithMSH15('NE');

    it('returns no ACK content for SENT status', () => {
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBeFalsy();
    });

    it('returns no ACK content for ERROR status', () => {
      const response = responder.getResponse(msg, null, Status.ERROR);
      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getMessage()).toBeFalsy();
    });

    it('returns no ACK content for FILTERED status', () => {
      const response = responder.getResponse(msg, null, Status.FILTERED);
      expect(response.getStatus()).toBe(Status.FILTERED);
      expect(response.getMessage()).toBeFalsy();
    });
  });

  // ─── MSH.15 = ER (Error only) ─────────────────────────────────

  describe('MSH.15 = ER (Error only)', () => {
    const msg = buildMsgWithMSH15('ER');

    it('generates ACK for ERROR status', () => {
      const response = responder.getResponse(msg, null, Status.ERROR);
      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getMessage()).toContain('MSA|AE|MSG001');
    });

    it('returns no ACK content for SENT status', () => {
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBeFalsy();
    });

    it('returns no ACK content for FILTERED status', () => {
      const response = responder.getResponse(msg, null, Status.FILTERED);
      expect(response.getStatus()).toBe(Status.FILTERED);
      expect(response.getMessage()).toBeFalsy();
    });

    it('returns no ACK content for QUEUED status', () => {
      const response = responder.getResponse(msg, null, Status.QUEUED);
      expect(response.getStatus()).toBe(Status.QUEUED);
      expect(response.getMessage()).toBeFalsy();
    });
  });

  // ─── MSH.15 = SU (Successful only) ────────────────────────────

  describe('MSH.15 = SU (Successful only)', () => {
    const msg = buildMsgWithMSH15('SU');

    it('generates ACK for SENT status', () => {
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });

    it('generates ACK for FILTERED status', () => {
      const response = responder.getResponse(msg, null, Status.FILTERED);
      expect(response.getStatus()).toBe(Status.FILTERED);
      expect(response.getMessage()).toContain('MSA|AR|MSG001');
    });

    it('returns no ACK content for ERROR status', () => {
      const response = responder.getResponse(msg, null, Status.ERROR);
      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getMessage()).toBeFalsy();
    });
  });

  // ─── MSH.15 missing or empty ──────────────────────────────────

  describe('MSH.15 missing or empty (defaults to AL)', () => {
    it('generates ACK when MSH.15 field is absent', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.SENT);
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });

    it('generates ACK when MSH.15 is empty string', () => {
      const msg = buildMsgWithMSH15('');
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });

    it('generates ACK when MSH.15 is unrecognized value', () => {
      const msg = buildMsgWithMSH15('XX');
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });
  });

  // ─── Status → ACK code mapping ────────────────────────────────

  describe('status to ACK code mapping', () => {
    it('maps ERROR to AE code', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.ERROR);
      expect(response.getMessage()).toContain('MSA|AE|');
    });

    it('maps FILTERED to AR code', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.FILTERED);
      expect(response.getMessage()).toContain('MSA|AR|');
    });

    it('maps SENT to AA code', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|');
    });

    it('maps RECEIVED to AA code', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.RECEIVED);
      expect(response.getMessage()).toContain('MSA|AA|');
    });

    it('maps PENDING to AA code', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.PENDING);
      expect(response.getMessage()).toContain('MSA|AA|');
    });
  });

  // ─── Custom ACK code properties ───────────────────────────────

  describe('custom ACK code properties', () => {
    it('uses custom successfulACKCode', () => {
      const custom = new HL7v2AutoResponder({ successfulACKCode: 'CA' });
      const response = custom.getResponse(TEST_MSG, null, Status.SENT);
      expect(response.getMessage()).toContain('MSA|CA|MSG001');
    });

    it('uses custom errorACKCode', () => {
      const custom = new HL7v2AutoResponder({ errorACKCode: 'CE' });
      const response = custom.getResponse(TEST_MSG, null, Status.ERROR);
      expect(response.getMessage()).toContain('MSA|CE|MSG001');
    });

    it('uses custom rejectedACKCode', () => {
      const custom = new HL7v2AutoResponder({ rejectedACKCode: 'CR' });
      const response = custom.getResponse(TEST_MSG, null, Status.FILTERED);
      expect(response.getMessage()).toContain('MSA|CR|MSG001');
    });

    it('uses custom ackMessage as text in MSA-3', () => {
      const custom = new HL7v2AutoResponder({ ackMessage: 'Message processed OK' });
      const response = custom.getResponse(TEST_MSG, null, Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|MSG001|Message processed OK');
    });
  });

  // ─── ACK message structure ────────────────────────────────────

  describe('ACK message structure', () => {
    it('contains MSH and MSA segments', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.SENT);
      const ack = response.getMessage();
      expect(ack).toMatch(/^MSH\|/);
      expect(ack).toContain('MSA|');
    });

    it('swaps sending and receiving applications in MSH', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.SENT);
      const ack = response.getMessage();
      // Original: MSH.3=SENDING, MSH.5=RECEIVING
      // ACK:     MSH.3=RECEIVING, MSH.5=SENDING
      const mshSegment = ack.split('\r')[0]!;
      const fields = mshSegment.split('|');
      expect(fields[2]).toBe('RECEIVING');  // MSH.3 in ACK = original MSH.5
      expect(fields[4]).toBe('SENDING');    // MSH.5 in ACK = original MSH.3
    });

    it('preserves message control ID in MSA-2', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });

    it('includes ACK message type', () => {
      const response = responder.getResponse(TEST_MSG, null, Status.SENT);
      const ack = response.getMessage();
      const mshSegment = ack.split('\r')[0]!;
      const fields = mshSegment.split('|');
      // MSH.9 (field index 8) should contain ACK
      expect(fields[8]).toContain('ACK');
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles lowercase MSH.15 values', () => {
      const msg = buildMsgWithMSH15('ne');
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getMessage()).toBeFalsy();
    });

    it('handles message with LF segment delimiter', () => {
      const msg = 'MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20260101120000||ADT^A01|MSG001|P|2.5\nPID|||12345||DOE^JOHN';
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });

    it('handles single-segment message (no PID)', () => {
      const msg = 'MSH|^~\\&|SENDING|FACILITY|RECEIVING|FACILITY|20260101120000||ADT^A01|MSG001|P|2.5';
      const response = responder.getResponse(msg, null, Status.SENT);
      expect(response.getMessage()).toContain('MSA|AA|MSG001');
    });

    it('handles very short message gracefully', () => {
      // The ACK generator throws for messages < 9 chars
      expect(() => {
        responder.getResponse('MSH', null, Status.SENT);
      }).toThrow();
    });
  });
});

// ─── DefaultAutoResponder ─────────────────────────────────────────

describe('DefaultAutoResponder', () => {
  let responder: DefaultAutoResponder;

  beforeEach(() => {
    responder = new DefaultAutoResponder();
  });

  it('returns no ACK content for SENT status', () => {
    const response = responder.getResponse('any message', null, Status.SENT);
    expect(response.getStatus()).toBe(Status.SENT);
    expect(response.getMessage()).toBeFalsy();
  });

  it('returns no ACK content for ERROR status', () => {
    const response = responder.getResponse('any message', null, Status.ERROR);
    expect(response.getStatus()).toBe(Status.ERROR);
    expect(response.getMessage()).toBeFalsy();
  });

  it('returns no ACK content for FILTERED status', () => {
    const response = responder.getResponse('any message', null, Status.FILTERED);
    expect(response.getStatus()).toBe(Status.FILTERED);
    expect(response.getMessage()).toBeFalsy();
  });

  it('preserves the status in the response', () => {
    for (const status of [Status.RECEIVED, Status.TRANSFORMED, Status.QUEUED, Status.PENDING]) {
      const response = responder.getResponse('msg', null, status);
      expect(response.getStatus()).toBe(status);
    }
  });
});
