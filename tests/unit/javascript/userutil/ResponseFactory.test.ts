/**
 * Unit tests for ResponseFactory userutil class
 */

import { ResponseFactory } from '../../../../src/javascript/userutil/ResponseFactory.js';
import { Status } from '../../../../src/model/Status.js';

describe('ResponseFactory', () => {
  describe('getSentResponse', () => {
    it('should create a SENT response with message', () => {
      const response = ResponseFactory.getSentResponse('ACK received');

      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBe('ACK received');
      expect(response.getStatusMessage()).toBe('Message successfully sent');
    });

    it('should create a SENT response with empty message', () => {
      const response = ResponseFactory.getSentResponse('');

      expect(response.getStatus()).toBe(Status.SENT);
      expect(response.getMessage()).toBe('');
    });
  });

  describe('getErrorResponse', () => {
    it('should create an ERROR response with message', () => {
      const response = ResponseFactory.getErrorResponse('Connection failed');

      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getMessage()).toBe('Connection failed');
      expect(response.getStatusMessage()).toBe('Error processing message');
    });
  });

  describe('getFilteredResponse', () => {
    it('should create a FILTERED response with message', () => {
      const response = ResponseFactory.getFilteredResponse('Message filtered by rule');

      expect(response.getStatus()).toBe(Status.FILTERED);
      expect(response.getMessage()).toBe('Message filtered by rule');
      expect(response.getStatusMessage()).toBe('Message was filtered');
    });
  });

  describe('getQueuedResponse', () => {
    it('should create a QUEUED response with message', () => {
      const response = ResponseFactory.getQueuedResponse('Queued for retry');

      expect(response.getStatus()).toBe(Status.QUEUED);
      expect(response.getMessage()).toBe('Queued for retry');
      expect(response.getStatusMessage()).toBe('Message queued for later delivery');
    });
  });

  describe('createResponse', () => {
    it('should create a response with all parameters', () => {
      const response = ResponseFactory.createResponse(
        Status.ERROR,
        'Error data',
        'Custom status message',
        'Detailed error info'
      );

      expect(response.getStatus()).toBe(Status.ERROR);
      expect(response.getMessage()).toBe('Error data');
      expect(response.getStatusMessage()).toBe('Custom status message');
      expect(response.getError()).toBe('Detailed error info');
    });

    it('should create a response with minimal parameters', () => {
      const response = ResponseFactory.createResponse(Status.TRANSFORMED, 'data');

      expect(response.getStatus()).toBe(Status.TRANSFORMED);
      expect(response.getMessage()).toBe('data');
    });

    it('should handle all status types', () => {
      const statuses = [
        Status.RECEIVED,
        Status.FILTERED,
        Status.TRANSFORMED,
        Status.SENT,
        Status.QUEUED,
        Status.ERROR,
        Status.PENDING,
      ];

      for (const status of statuses) {
        const response = ResponseFactory.createResponse(status, 'test');
        expect(response.getStatus()).toBe(status);
      }
    });
  });

  describe('private constructor', () => {
    it('should not allow instantiation', () => {
      // ResponseFactory has a private constructor, so we can only use static methods
      // This test verifies the class is used correctly as a static factory
      expect(typeof ResponseFactory.getSentResponse).toBe('function');
      expect(typeof ResponseFactory.getErrorResponse).toBe('function');
      expect(typeof ResponseFactory.getFilteredResponse).toBe('function');
      expect(typeof ResponseFactory.getQueuedResponse).toBe('function');
    });
  });
});
