/**
 * Unit tests for ImmutableResponse userutil class
 */

import { ImmutableResponse } from '../../../../src/javascript/userutil/ImmutableResponse.js';
import { Response } from '../../../../src/model/Response.js';
import { Status } from '../../../../src/model/Status.js';

describe('ImmutableResponse', () => {
  describe('constructor', () => {
    it('should wrap a Response object', () => {
      const response = new Response({
        status: Status.SENT,
        message: 'test message',
        statusMessage: 'success',
        error: '',
      });

      const immutableResponse = new ImmutableResponse(response);

      expect(immutableResponse.getMessage()).toBe('test message');
      expect(immutableResponse.getNewMessageStatus()).toBe(Status.SENT);
      expect(immutableResponse.getStatusMessage()).toBe('success');
      expect(immutableResponse.getError()).toBe('');
    });
  });

  describe('getMessage', () => {
    it('should return the response message', () => {
      const response = Response.sent('Hello World');
      const immutable = new ImmutableResponse(response);

      expect(immutable.getMessage()).toBe('Hello World');
    });

    it('should return empty string for empty message', () => {
      const response = Response.sent();
      const immutable = new ImmutableResponse(response);

      expect(immutable.getMessage()).toBe('');
    });
  });

  describe('getNewMessageStatus', () => {
    it('should return SENT status', () => {
      const response = Response.sent('msg');
      const immutable = new ImmutableResponse(response);

      expect(immutable.getNewMessageStatus()).toBe(Status.SENT);
    });

    it('should return ERROR status', () => {
      const response = Response.error('error message');
      const immutable = new ImmutableResponse(response);

      expect(immutable.getNewMessageStatus()).toBe(Status.ERROR);
    });

    it('should return FILTERED status', () => {
      const response = Response.filtered();
      const immutable = new ImmutableResponse(response);

      expect(immutable.getNewMessageStatus()).toBe(Status.FILTERED);
    });

    it('should return QUEUED status', () => {
      const response = Response.queued();
      const immutable = new ImmutableResponse(response);

      expect(immutable.getNewMessageStatus()).toBe(Status.QUEUED);
    });
  });

  describe('getError', () => {
    it('should return error string for error response', () => {
      const response = new Response({
        status: Status.ERROR,
        message: 'error data',
        statusMessage: 'Error occurred',
        error: 'Connection refused',
      });
      const immutable = new ImmutableResponse(response);

      expect(immutable.getError()).toBe('Connection refused');
    });

    it('should return empty string when no error', () => {
      const response = Response.sent('success');
      const immutable = new ImmutableResponse(response);

      expect(immutable.getError()).toBe('');
    });
  });

  describe('getStatusMessage', () => {
    it('should return status message', () => {
      const response = new Response({
        status: Status.SENT,
        message: 'data',
        statusMessage: 'Message delivered successfully',
      });
      const immutable = new ImmutableResponse(response);

      expect(immutable.getStatusMessage()).toBe('Message delivered successfully');
    });
  });

  describe('getResponse', () => {
    it('should return the underlying Response object', () => {
      const response = Response.sent('test');
      const immutable = new ImmutableResponse(response);

      expect(immutable.getResponse()).toBe(response);
    });
  });

  describe('immutability', () => {
    it('should not expose setters', () => {
      const immutable = new ImmutableResponse(Response.sent('test'));

      // Verify that setter methods don't exist
      expect((immutable as any).setMessage).toBeUndefined();
      expect((immutable as any).setStatus).toBeUndefined();
      expect((immutable as any).setError).toBeUndefined();
      expect((immutable as any).setStatusMessage).toBeUndefined();
    });
  });
});
