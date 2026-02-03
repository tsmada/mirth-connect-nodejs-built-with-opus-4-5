import { EOL } from 'os';
import {
  ErrorMessageBuilder,
  JavaScriptError,
  buildErrorMessage,
  buildErrorResponse,
  createJavaScriptError,
} from '../../../src/util/ErrorMessageBuilder';

describe('ErrorMessageBuilder', () => {
  describe('buildErrorMessage', () => {
    it('should build error message with just error type', () => {
      const result = ErrorMessageBuilder.buildErrorMessage('Transformer');
      expect(result).toBe('Transformer error');
    });

    it('should include custom message when provided', () => {
      const result = ErrorMessageBuilder.buildErrorMessage('Filter', 'Invalid patient ID');
      expect(result).toBe(`Filter error${EOL}ERROR MESSAGE: Invalid patient ID`);
    });

    it('should include stack trace when error is provided', () => {
      const error = new Error('Something went wrong');
      const result = ErrorMessageBuilder.buildErrorMessage('Connector', null, error);

      expect(result).toContain('Connector error');
      expect(result).toContain('Error: Something went wrong');
    });

    it('should include error source line for JavaScript errors', () => {
      const error = createJavaScriptError(
        'Undefined variable',
        'var x = unknownVar;',
        5
      );
      const result = ErrorMessageBuilder.buildErrorMessage('Script', 'Variable not defined', error);

      expect(result).toContain('Script error');
      expect(result).toContain('ERROR SOURCE: var x = unknownVar;');
      expect(result).toContain('ERROR MESSAGE: Variable not defined');
    });

    it('should handle all components together', () => {
      const error = createJavaScriptError('Test error', 'badCode();');
      const result = ErrorMessageBuilder.buildErrorMessage('Test', 'Custom message', error);

      expect(result).toContain('Test error');
      expect(result).toContain('ERROR SOURCE: badCode();');
      expect(result).toContain('ERROR MESSAGE: Custom message');
      expect(result).toContain('JavaScriptError: Test error');
    });

    it('should handle empty custom message', () => {
      const result = ErrorMessageBuilder.buildErrorMessage('Transformer', '');
      expect(result).toBe('Transformer error');
    });

    it('should handle whitespace-only custom message', () => {
      const result = ErrorMessageBuilder.buildErrorMessage('Transformer', '   ');
      expect(result).toBe('Transformer error');
    });

    it('should handle null error', () => {
      const result = ErrorMessageBuilder.buildErrorMessage('Test', 'Message', null);
      expect(result).toBe(`Test error${EOL}ERROR MESSAGE: Message`);
    });

    it('should handle undefined error', () => {
      const result = ErrorMessageBuilder.buildErrorMessage('Test', 'Message', undefined);
      expect(result).toBe(`Test error${EOL}ERROR MESSAGE: Message`);
    });
  });

  describe('buildErrorResponse', () => {
    it('should build response with just custom message', () => {
      const result = ErrorMessageBuilder.buildErrorResponse('Connection failed');
      expect(result).toBe('Connection failed');
    });

    it('should include error details when provided', () => {
      const error = new Error('Timeout');
      const result = ErrorMessageBuilder.buildErrorResponse('Connection failed', error);
      expect(result).toBe('Connection failed [Error: Timeout]');
    });

    it('should handle error without message', () => {
      const error = new Error();
      const result = ErrorMessageBuilder.buildErrorResponse('Failed', error);
      expect(result).toBe('Failed [Error: ]');
    });

    it('should use error name if available', () => {
      const error = new TypeError('Invalid type');
      const result = ErrorMessageBuilder.buildErrorResponse('Processing error', error);
      expect(result).toBe('Processing error [TypeError: Invalid type]');
    });

    it('should handle null error', () => {
      const result = ErrorMessageBuilder.buildErrorResponse('Message', null);
      expect(result).toBe('Message');
    });

    it('should handle undefined error', () => {
      const result = ErrorMessageBuilder.buildErrorResponse('Message', undefined);
      expect(result).toBe('Message');
    });

    it('should handle custom error classes', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Custom issue');
      const result = ErrorMessageBuilder.buildErrorResponse('Operation failed', error);
      expect(result).toBe('Operation failed [CustomError: Custom issue]');
    });
  });

  describe('createJavaScriptError', () => {
    it('should create error with all properties', () => {
      const error = ErrorMessageBuilder.createJavaScriptError(
        'Test message',
        'var x = 1;',
        10,
        5,
        'script.js'
      );

      expect(error.message).toBe('Test message');
      expect(error.name).toBe('JavaScriptError');
      expect(error.lineSource).toBe('var x = 1;');
      expect(error.lineNumber).toBe(10);
      expect(error.columnNumber).toBe(5);
      expect(error.fileName).toBe('script.js');
    });

    it('should create error with just message', () => {
      const error = ErrorMessageBuilder.createJavaScriptError('Simple error');

      expect(error.message).toBe('Simple error');
      expect(error.name).toBe('JavaScriptError');
      expect(error.lineSource).toBeUndefined();
      expect(error.lineNumber).toBeUndefined();
    });

    it('should create error with partial properties', () => {
      const error = ErrorMessageBuilder.createJavaScriptError(
        'Partial error',
        'code here',
        undefined,
        undefined,
        'file.js'
      );

      expect(error.lineSource).toBe('code here');
      expect(error.lineNumber).toBeUndefined();
      expect(error.fileName).toBe('file.js');
    });

    it('should be instanceof Error', () => {
      const error = ErrorMessageBuilder.createJavaScriptError('Test');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('shorthand exports', () => {
    it('should export buildErrorMessage as shorthand', () => {
      expect(buildErrorMessage).toBe(ErrorMessageBuilder.buildErrorMessage);
    });

    it('should export buildErrorResponse as shorthand', () => {
      expect(buildErrorResponse).toBe(ErrorMessageBuilder.buildErrorResponse);
    });

    it('should export createJavaScriptError as shorthand', () => {
      expect(createJavaScriptError).toBe(ErrorMessageBuilder.createJavaScriptError);
    });
  });

  describe('edge cases', () => {
    it('should handle error with no stack trace', () => {
      const error = new Error('No stack');
      // Clear the stack
      error.stack = undefined;

      const result = ErrorMessageBuilder.buildErrorMessage('Test', 'Msg', error);
      expect(result).toBe(`Test error${EOL}ERROR MESSAGE: Msg`);
    });

    it('should handle JavaScript error with empty lineSource', () => {
      const error: JavaScriptError = new Error('Test') as JavaScriptError;
      error.lineSource = '';

      const result = ErrorMessageBuilder.buildErrorMessage('Script', null, error);
      expect(result).not.toContain('ERROR SOURCE:');
    });

    it('should handle JavaScript error with whitespace lineSource', () => {
      const error: JavaScriptError = new Error('Test') as JavaScriptError;
      error.lineSource = '   ';

      const result = ErrorMessageBuilder.buildErrorMessage('Script', null, error);
      expect(result).not.toContain('ERROR SOURCE:');
    });
  });
});
