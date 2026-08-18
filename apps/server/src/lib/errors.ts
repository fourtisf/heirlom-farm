/**
 * Every rejection the client can provoke is one of these. Anything else is a
 * bug and becomes a 500 with no detail leaked.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = (message = 'Sign in first.') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const tooMany = (message = 'Slow down.') => new ApiError(429, 'rate_limited', message);
