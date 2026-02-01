import { Response } from '../../../src/model/Response';
import { Status } from '../../../src/model/Status';

describe('Response', () => {
  describe('static factories', () => {
    it('should create a sent response', () => {
      const response = Response.sent('ACK message');

      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBe('ACK message');
      expect(response.isSuccess()).toBe(true);
      expect(response.isError()).toBe(false);
    });

    it('should create a queued response', () => {
      const response = Response.queued('Queued for retry');

      expect(response.getStatus()).toBe(Status.QUEUED);
      expect(response.isQueued()).toBe(true);
      expect(response.isSuccess()).toBe(false);
    });

    it('should create an error response', () => {
      const response = Response.error('Connection refused', 'Failed message');

      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getError()).toBe('Connection refused');
      expect(response.getMessage()).toBe('Failed message');
      expect(response.isError()).toBe(true);
      expect(response.isSuccess()).toBe(false);
    });

    it('should create a filtered response', () => {
      const response = Response.filtered();

      expect(response.getStatus()).toBe(Status.FILTERED);
      expect(response.isFiltered()).toBe(true);
    });
  });

  describe('constructor', () => {
    it('should create a response with all fields', () => {
      const response = new Response({
        status: Status.SENT,
        message: 'response body',
        statusMessage: 'OK',
        error: '',
      });

      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBe('response body');
      expect(response.getStatusMessage()).toBe('OK');
      expect(response.getError()).toBe('');
    });
  });

  describe('setters', () => {
    it('should allow modifying response fields', () => {
      const response = Response.sent();

      response.setStatus(Status.ERROR);
      response.setMessage('new message');
      response.setStatusMessage('Failed');
      response.setError('timeout');

      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getMessage()).toBe('new message');
      expect(response.getStatusMessage()).toBe('Failed');
      expect(response.getError()).toBe('timeout');
    });
  });
});
