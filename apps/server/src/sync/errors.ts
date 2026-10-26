export class SyncRetryLaterError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SyncRetryLaterError';
    this.code = code;
    Object.setPrototypeOf(this, SyncRetryLaterError.prototype);
  }
}

export class SyncRejectedError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SyncRejectedError';
    this.code = code;
    Object.setPrototypeOf(this, SyncRejectedError.prototype);
  }
}
