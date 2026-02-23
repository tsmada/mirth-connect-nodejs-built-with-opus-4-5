/**
 * ResponseSelector Behavioral Contract Tests
 *
 * Validates the behavioral contracts of ResponseSelector — the component that
 * decides which response to return to the source connector after message processing.
 *
 * Tests cover all 7 response selection modes:
 *   - None / null → no response
 *   - Auto-generate (Before processing) → RECEIVED status
 *   - Auto-generate (After source transformer) → source connector's status
 *   - Auto-generate (Destinations completed) → highest-precedence destination status
 *   - Named destination (d1, d2, etc.) → response from responseMap
 *   - Destination name lookup → response from responseMap by connector name
 *   - Postprocessor (d_postprocessor) → postprocessor script return value
 *
 * Status precedence order: FILTERED(1) < QUEUED(2) < SENT(3) < ERROR(4)
 */

import {
  ResponseSelector,
  RESPONSE_NONE,
  RESPONSE_AUTO_BEFORE,
  RESPONSE_SOURCE_TRANSFORMED,
  RESPONSE_DESTINATIONS_COMPLETED,
  RESPONSE_POSTPROCESSOR,
  RESPONSE_STATUS_PRECEDENCE,
} from '../../../../src/donkey/channel/ResponseSelector';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Message } from '../../../../src/model/Message';
import { Response } from '../../../../src/model/Response';
import { Status } from '../../../../src/model/Status';

/**
 * Build a Message with a source ConnectorMessage and N destination ConnectorMessages.
 * Source is always metaDataId=0, destinations are 1..N.
 */
function buildMessage(
  sourceStatus: Status,
  destStatuses: Status[],
  destNames?: string[]
): { message: Message; source: ConnectorMessage } {
  const source = new ConnectorMessage({
    messageId: 1,
    metaDataId: 0,
    channelId: 'test-ch',
    channelName: 'Test Channel',
    connectorName: 'Source',
    serverId: 'srv-1',
    receivedDate: new Date(),
    status: sourceStatus,
  });
  source.setRawData('<test>raw content</test>');

  const message = new Message({
    messageId: 1,
    serverId: 'srv-1',
    channelId: 'test-ch',
    receivedDate: new Date(),
    processed: false,
  });
  message.getConnectorMessages().set(0, source);

  destStatuses.forEach((status, i) => {
    const name = destNames?.[i] ?? `Dest ${i + 1}`;
    const dest = new ConnectorMessage({
      messageId: 1,
      metaDataId: i + 1,
      channelId: 'test-ch',
      channelName: 'Test Channel',
      connectorName: name,
      serverId: 'srv-1',
      receivedDate: new Date(),
      status,
    });
    message.getConnectorMessages().set(i + 1, dest);
  });

  return { message, source };
}

describe('ResponseSelector Behavioral Contracts', () => {
  let selector: ResponseSelector;

  beforeEach(() => {
    selector = new ResponseSelector();
  });

  // ── T2.1: RESPONSE_NONE → null ──────────────────────────────────────
  it('T2.1: returns null when respondFromName is RESPONSE_NONE', () => {
    selector.setRespondFromName(RESPONSE_NONE);
    const { message, source } = buildMessage(Status.TRANSFORMED, [Status.SENT]);

    const response = selector.getResponse(source, message);

    expect(response).toBeNull();
    expect(selector.canRespond()).toBe(false);
  });

  // ── T2.2: respondFromName null → null ───────────────────────────────
  it('T2.2: returns null when respondFromName is null (default)', () => {
    // respondFromName defaults to null in constructor
    const { message, source } = buildMessage(Status.TRANSFORMED, [Status.SENT]);

    const response = selector.getResponse(source, message);

    expect(response).toBeNull();
    expect(selector.canRespond()).toBe(false);
  });

  // ── T2.3: RESPONSE_AUTO_BEFORE → RECEIVED ──────────────────────────
  it('T2.3: returns RECEIVED status for auto-before-processing mode', () => {
    selector.setRespondFromName(RESPONSE_AUTO_BEFORE);
    const { message, source } = buildMessage(Status.TRANSFORMED, []);

    const response = selector.getResponse(source, message);

    expect(response).not.toBeNull();
    expect(response!.getStatus()).toBe(Status.RECEIVED);
    expect(selector.canRespond()).toBe(true);
  });

  // ── T2.4: RESPONSE_SOURCE_TRANSFORMED → source's status ────────────
  it('T2.4: returns auto-response with source connector status (TRANSFORMED)', () => {
    selector.setRespondFromName(RESPONSE_SOURCE_TRANSFORMED);
    const { message, source } = buildMessage(Status.TRANSFORMED, []);

    const response = selector.getResponse(source, message);

    expect(response).not.toBeNull();
    expect(response!.getStatus()).toBe(Status.TRANSFORMED);
  });

  // ── T2.5: DESTINATIONS_COMPLETED — all SENT → SENT ─────────────────
  it('T2.5: returns SENT when all destinations completed successfully', () => {
    selector.setRespondFromName(RESPONSE_DESTINATIONS_COMPLETED);
    selector.setNumDestinations(3);
    const { message, source } = buildMessage(Status.TRANSFORMED, [
      Status.SENT,
      Status.SENT,
      Status.SENT,
    ]);

    const response = selector.getResponse(source, message);

    expect(response).not.toBeNull();
    expect(response!.getStatus()).toBe(Status.SENT);
  });

  // ── T2.6: DESTINATIONS_COMPLETED — mixed SENT+ERROR → ERROR ────────
  it('T2.6: returns ERROR (highest precedence) when mixed SENT and ERROR', () => {
    selector.setRespondFromName(RESPONSE_DESTINATIONS_COMPLETED);
    selector.setNumDestinations(2);
    const { message, source } = buildMessage(Status.TRANSFORMED, [
      Status.SENT,
      Status.ERROR,
    ]);

    const response = selector.getResponse(source, message);

    expect(response).not.toBeNull();
    expect(response!.getStatus()).toBe(Status.ERROR);
  });

  // ── T2.7: DESTINATIONS_COMPLETED — FILTERED+SENT → SENT ────────────
  it('T2.7: returns SENT when mixed FILTERED and SENT (SENT > FILTERED)', () => {
    selector.setRespondFromName(RESPONSE_DESTINATIONS_COMPLETED);
    selector.setNumDestinations(2);
    const { message, source } = buildMessage(Status.TRANSFORMED, [
      Status.FILTERED,
      Status.SENT,
    ]);

    const response = selector.getResponse(source, message);

    expect(response).not.toBeNull();
    expect(response!.getStatus()).toBe(Status.SENT);
  });

  // ── T2.8: DESTINATIONS_COMPLETED — all QUEUED → QUEUED ─────────────
  it('T2.8: returns QUEUED when all destinations are queued', () => {
    selector.setRespondFromName(RESPONSE_DESTINATIONS_COMPLETED);
    selector.setNumDestinations(2);
    const { message, source } = buildMessage(Status.TRANSFORMED, [
      Status.QUEUED,
      Status.QUEUED,
    ]);

    const response = selector.getResponse(source, message);

    expect(response).not.toBeNull();
    expect(response!.getStatus()).toBe(Status.QUEUED);
  });

  // ── T2.9: DESTINATIONS_COMPLETED — all FILTERED → FILTERED ─────────
  it('T2.9: returns FILTERED when all destinations are filtered', () => {
    selector.setRespondFromName(RESPONSE_DESTINATIONS_COMPLETED);
    selector.setNumDestinations(2);
    const { message, source } = buildMessage(Status.TRANSFORMED, [
      Status.FILTERED,
      Status.FILTERED,
    ]);

    const response = selector.getResponse(source, message);

    expect(response).not.toBeNull();
    expect(response!.getStatus()).toBe(Status.FILTERED);
  });

  // ── T2.10: Named destination 'd1' → response from responseMap ──────
  it('T2.10: returns Response from responseMap for named destination d1', () => {
    selector.setRespondFromName('d1');
    const { message, source } = buildMessage(Status.TRANSFORMED, [Status.SENT]);

    const expectedResponse = new Response({
      status: Status.SENT,
      message: 'Destination 1 ACK',
      statusMessage: 'OK',
    });
    source.getResponseMap().set('d1', expectedResponse);

    const response = selector.getResponse(source, message);

    expect(response).toBe(expectedResponse);
    expect(response!.getStatus()).toBe(Status.SENT);
    expect(response!.getMessage()).toBe('Destination 1 ACK');
  });

  // ── T2.11: Named destination by connector name ──────────────────────
  it('T2.11: returns response from responseMap when using connector name as key', () => {
    selector.setRespondFromName('HTTP Sender');
    const { message, source } = buildMessage(Status.TRANSFORMED, [Status.SENT], ['HTTP Sender']);

    const expectedResponse = Response.sent('HTTP 200 OK');
    source.getResponseMap().set('HTTP Sender', expectedResponse);

    const response = selector.getResponse(source, message);

    expect(response).toBe(expectedResponse);
    expect(response!.getStatus()).toBe(Status.SENT);
    expect(response!.getMessage()).toBe('HTTP 200 OK');
  });

  // ── T2.12: Invalid/nonexistent destination name → null ──────────────
  it('T2.12: returns null for nonexistent destination name in responseMap', () => {
    selector.setRespondFromName('nonexistent-dest');
    const { message, source } = buildMessage(Status.TRANSFORMED, [Status.SENT]);

    const response = selector.getResponse(source, message);

    expect(response).toBeNull();
  });

  // ── T2.13: Postprocessor response ('d_postprocessor') ───────────────
  it('T2.13: returns postprocessor Response from responseMap at d_postprocessor key', () => {
    selector.setRespondFromName(RESPONSE_POSTPROCESSOR);
    const { message, source } = buildMessage(Status.TRANSFORMED, [Status.SENT]);

    const postprocessorResponse = new Response({
      status: Status.SENT,
      message: 'Postprocessor completed',
      statusMessage: 'Custom postprocessor result',
    });
    source.getResponseMap().set('d_postprocessor', postprocessorResponse);

    const response = selector.getResponse(source, message);

    expect(response).toBe(postprocessorResponse);
    expect(response!.getStatus()).toBe(Status.SENT);
    expect(response!.getMessage()).toBe('Postprocessor completed');
  });

  // ── T2.14: Status precedence ordering ───────────────────────────────
  it('T2.14: status precedence is ERROR > SENT > QUEUED > FILTERED', () => {
    // Verify the precedence array order
    const filteredIdx = RESPONSE_STATUS_PRECEDENCE.indexOf(Status.FILTERED);
    const queuedIdx = RESPONSE_STATUS_PRECEDENCE.indexOf(Status.QUEUED);
    const sentIdx = RESPONSE_STATUS_PRECEDENCE.indexOf(Status.SENT);
    const errorIdx = RESPONSE_STATUS_PRECEDENCE.indexOf(Status.ERROR);

    // All statuses must be present
    expect(filteredIdx).toBeGreaterThanOrEqual(0);
    expect(queuedIdx).toBeGreaterThanOrEqual(0);
    expect(sentIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeGreaterThanOrEqual(0);

    // Verify ordering: higher index = higher precedence
    expect(errorIdx).toBeGreaterThan(sentIdx);
    expect(sentIdx).toBeGreaterThan(queuedIdx);
    expect(queuedIdx).toBeGreaterThan(filteredIdx);

    // Also verify via the static helper method
    const errorPrec = ResponseSelector.getStatusPrecedence(Status.ERROR)!;
    const sentPrec = ResponseSelector.getStatusPrecedence(Status.SENT)!;
    const queuedPrec = ResponseSelector.getStatusPrecedence(Status.QUEUED)!;
    const filteredPrec = ResponseSelector.getStatusPrecedence(Status.FILTERED)!;

    expect(errorPrec).toBeGreaterThan(sentPrec);
    expect(sentPrec).toBeGreaterThan(queuedPrec);
    expect(queuedPrec).toBeGreaterThan(filteredPrec);
  });
});
