/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/Future.java
 *
 * Purpose: A Future represents the result of an asynchronous computation. Methods are provided
 * to check if the computation is complete, to wait for its completion, and to retrieve the
 * result of the computation.
 *
 * Key behaviors to replicate:
 * - Wrap a Promise to provide Future-like interface for user scripts
 * - Support get() with optional timeout
 * - Support cancellation (best-effort in JavaScript)
 * - Support isDone() and isCancelled() checks
 */

/**
 * Error thrown when a Future operation times out.
 */
export class TimeoutError extends Error {
  constructor(message: string = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when a Future is cancelled.
 */
export class CancellationError extends Error {
  constructor(message: string = 'Operation was cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

/**
 * A Future represents the result of an asynchronous computation. Methods are provided to
 * check if the computation is complete, to wait for its completion, and to retrieve the result
 * of the computation. The result can only be retrieved using method get when the computation
 * has completed, blocking if necessary until it is ready. Cancellation is performed by the
 * cancel method. Additional methods are provided to determine if the task completed
 * normally or was cancelled. Once a computation has completed, the computation cannot be cancelled.
 */
export class Future<V> {
  private promise: Promise<V>;
  private _isDone: boolean = false;
  private _isCancelled: boolean = false;
  private _result: V | undefined = undefined;
  private _error: Error | undefined = undefined;
  private _cancelRequested: boolean = false;

  /**
   * Creates a new Future wrapping the given Promise.
   *
   * @param promise The underlying Promise to wrap.
   */
  constructor(promise: Promise<V>) {
    this.promise = promise;

    // Track completion state
    this.promise
      .then((result) => {
        if (!this._cancelRequested) {
          this._result = result;
          this._isDone = true;
        }
      })
      .catch((error) => {
        if (!this._cancelRequested) {
          this._error = error instanceof Error ? error : new Error(String(error));
          this._isDone = true;
        }
      });
  }

  /**
   * Attempts to cancel execution of this task. This attempt will fail if the task has already
   * completed, has already been cancelled, or could not be cancelled for some other reason. If
   * successful, and this task has not started when cancel is called, this task should
   * never run. If the task has already started, then the mayInterruptIfRunning parameter
   * determines whether the thread executing this task should be interrupted in an attempt to stop
   * the task.
   *
   * After this method returns, subsequent calls to isDone will always return
   * true. Subsequent calls to isCancelled will always return true if
   * this method returned true.
   *
   * Note: In JavaScript, we cannot truly interrupt a running task, so cancellation is
   * best-effort. If the task hasn't completed yet, we mark it as cancelled and ignore its result.
   *
   * @param mayInterruptIfRunning true if the thread executing this task should be interrupted;
   *        otherwise, in-progress tasks are allowed to complete (not used in JS implementation)
   * @return false if the task could not be cancelled, typically because it has already
   *         completed normally; true otherwise
   */
  cancel(_mayInterruptIfRunning: boolean = true): boolean {
    if (this._isDone || this._isCancelled) {
      return false;
    }

    this._cancelRequested = true;
    this._isCancelled = true;
    this._isDone = true;
    return true;
  }

  /**
   * Returns true if this task was cancelled before it completed normally.
   *
   * @return true if this task was cancelled before it completed
   */
  isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * Returns true if this task completed.
   *
   * Completion may be due to normal termination, an exception, or cancellation -- in all of these
   * cases, this method will return true.
   *
   * @return true if this task completed
   */
  isDone(): boolean {
    return this._isDone;
  }

  /**
   * Waits if necessary for the computation to complete, and then retrieves its result.
   *
   * @return the computed result
   * @throws CancellationError if the computation was cancelled
   * @throws Error if the computation threw an exception
   */
  async get(): Promise<V>;

  /**
   * Waits if necessary for at most the given time for the computation to complete, and then
   * retrieves its result, if available.
   *
   * @param timeoutInMillis the maximum time to wait, in milliseconds
   * @return the computed result
   * @throws CancellationError if the computation was cancelled
   * @throws Error if the computation threw an exception
   * @throws TimeoutError if the wait timed out
   */
  async get(timeoutInMillis: number): Promise<V>;

  // Implementation
  async get(timeoutInMillis?: number): Promise<V> {
    if (this._isCancelled) {
      throw new CancellationError();
    }

    if (this._isDone) {
      if (this._error) {
        throw this._error;
      }
      return this._result as V;
    }

    if (timeoutInMillis !== undefined) {
      return this.getWithTimeout(timeoutInMillis);
    }

    // Wait indefinitely
    try {
      const result = await this.promise;
      if (this._isCancelled) {
        throw new CancellationError();
      }
      return result;
    } catch (error) {
      if (this._isCancelled) {
        throw new CancellationError();
      }
      // Convert non-Error rejections to Error
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Internal method to implement timeout behavior.
   */
  private async getWithTimeout(timeoutInMillis: number): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;

      const timeoutPromise = new Promise<never>((_, timeoutReject) => {
        timeoutId = setTimeout(() => {
          timeoutReject(new TimeoutError(`Operation timed out after ${timeoutInMillis}ms`));
        }, timeoutInMillis);
      });

      Promise.race([this.promise, timeoutPromise])
        .then((result) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          if (this._isCancelled) {
            reject(new CancellationError());
          } else {
            resolve(result);
          }
        })
        .catch((error) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          if (this._isCancelled) {
            reject(new CancellationError());
          } else {
            reject(error);
          }
        });
    });
  }

  /**
   * Create a completed Future with the given value.
   * Useful for testing or returning immediate results.
   */
  static resolved<T>(value: T): Future<T> {
    const future = new Future<T>(Promise.resolve(value));
    // Immediately mark as done since Promise.resolve is already resolved
    future._isDone = true;
    future._result = value;
    return future;
  }

  /**
   * Create a failed Future with the given error.
   * Useful for testing or returning immediate errors.
   */
  static rejected<T>(error: Error): Future<T> {
    return new Future<T>(Promise.reject(error));
  }
}
