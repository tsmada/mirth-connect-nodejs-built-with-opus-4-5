/**
 * Unit tests for Future userutil class
 */

import {
  Future,
  TimeoutError,
  CancellationError,
} from '../../../../src/javascript/userutil/Future.js';

describe('Future', () => {
  describe('constructor', () => {
    it('should create a Future wrapping a Promise', () => {
      const future = new Future(Promise.resolve('test'));
      expect(future).toBeInstanceOf(Future);
    });
  });

  describe('get()', () => {
    it('should return resolved value', async () => {
      const future = new Future(Promise.resolve('hello'));
      const result = await future.get();
      expect(result).toBe('hello');
    });

    it('should throw on rejected promise', async () => {
      const error = new Error('test error');
      const future = new Future(Promise.reject(error));
      await expect(future.get()).rejects.toThrow('test error');
    });

    it('should convert non-Error rejections to Error', async () => {
      const future = new Future(Promise.reject('string error'));
      await expect(future.get()).rejects.toThrow('string error');
    });

    it('should return cached result on subsequent calls', async () => {
      let callCount = 0;
      const promise = new Promise<number>((resolve) => {
        callCount++;
        resolve(42);
      });
      const future = new Future(promise);

      const result1 = await future.get();
      const result2 = await future.get();

      expect(result1).toBe(42);
      expect(result2).toBe(42);
    });
  });

  describe('get(timeout)', () => {
    it('should return value before timeout', async () => {
      const future = new Future(
        new Promise((resolve) => setTimeout(() => resolve('quick'), 10))
      );
      const result = await future.get(1000);
      expect(result).toBe('quick');
    });

    it('should throw TimeoutError when timeout expires', async () => {
      const future = new Future(
        new Promise((resolve) => setTimeout(() => resolve('slow'), 1000))
      );
      await expect(future.get(10)).rejects.toThrow(TimeoutError);
    });

    it('should include timeout duration in error message', async () => {
      const future = new Future(
        new Promise((resolve) => setTimeout(() => resolve('slow'), 1000))
      );
      await expect(future.get(50)).rejects.toThrow('50ms');
    });
  });

  describe('isDone()', () => {
    it('should return false for pending promise', () => {
      const future = new Future(new Promise(() => {}));
      expect(future.isDone()).toBe(false);
    });

    it('should return true after promise resolves', async () => {
      const future = new Future(Promise.resolve('done'));
      await future.get();
      expect(future.isDone()).toBe(true);
    });

    it('should return true after promise rejects', async () => {
      const future = new Future(Promise.reject(new Error('failed')));
      try {
        await future.get();
      } catch {
        // Expected
      }
      expect(future.isDone()).toBe(true);
    });

    it('should return true after cancellation', () => {
      const future = new Future(new Promise(() => {}));
      future.cancel(true);
      expect(future.isDone()).toBe(true);
    });
  });

  describe('isCancelled()', () => {
    it('should return false before cancellation', () => {
      const future = new Future(new Promise(() => {}));
      expect(future.isCancelled()).toBe(false);
    });

    it('should return true after cancellation', () => {
      const future = new Future(new Promise(() => {}));
      future.cancel(true);
      expect(future.isCancelled()).toBe(true);
    });

    it('should return false after completion', async () => {
      const future = new Future(Promise.resolve('done'));
      await future.get();
      expect(future.isCancelled()).toBe(false);
    });
  });

  describe('cancel()', () => {
    it('should return true when cancelling pending future', () => {
      const future = new Future(new Promise(() => {}));
      expect(future.cancel(true)).toBe(true);
    });

    it('should return false when cancelling completed future', async () => {
      const future = new Future(Promise.resolve('done'));
      await future.get();
      expect(future.cancel(true)).toBe(false);
    });

    it('should return false when cancelling already cancelled future', () => {
      const future = new Future(new Promise(() => {}));
      future.cancel(true);
      expect(future.cancel(true)).toBe(false);
    });

    it('should cause get() to throw CancellationError', async () => {
      const future = new Future(new Promise(() => {}));
      future.cancel(true);
      await expect(future.get()).rejects.toThrow(CancellationError);
    });

    it('should cause get(timeout) to throw CancellationError', async () => {
      const future = new Future(new Promise(() => {}));
      future.cancel(true);
      await expect(future.get(1000)).rejects.toThrow(CancellationError);
    });
  });

  describe('cancellation during wait', () => {
    it('should throw CancellationError if cancelled while waiting', async () => {
      const future = new Future(
        new Promise((resolve) => setTimeout(() => resolve('value'), 100))
      );

      // Start waiting and cancel in parallel
      const getPromise = future.get(1000);
      setTimeout(() => future.cancel(true), 10);

      await expect(getPromise).rejects.toThrow(CancellationError);
    });
  });

  describe('static helpers', () => {
    describe('resolved()', () => {
      it('should create a completed future with value', async () => {
        const future = Future.resolved('test');
        expect(future.isDone()).toBe(true);
        const result = await future.get();
        expect(result).toBe('test');
      });

      it('should work with null value', async () => {
        const future = Future.resolved(null);
        const result = await future.get();
        expect(result).toBeNull();
      });
    });

    describe('rejected()', () => {
      it('should create a failed future', async () => {
        const error = new Error('test error');
        const future = Future.rejected<string>(error);
        await expect(future.get()).rejects.toThrow('test error');
      });
    });
  });

  describe('void futures', () => {
    it('should handle void promises', async () => {
      const future = new Future<void>(Promise.resolve());
      await future.get();
      expect(future.isDone()).toBe(true);
    });

    it('should work with async operations returning void', async () => {
      const sideEffect: string[] = [];
      const future = new Future<void>(
        (async () => {
          sideEffect.push('executed');
        })()
      );
      await future.get();
      expect(sideEffect).toEqual(['executed']);
    });
  });
});
