export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class GoneError extends Error {
  constructor(
    message: string,
    public readonly receipt: {
      cid: string;
      requestid: string;
      expiredAt: number;
    }
  ) {
    super(message);
    this.name = 'GoneError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export class GatewayTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayTimeoutError';
  }
}

export class UpstreamServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamServiceError';
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}
