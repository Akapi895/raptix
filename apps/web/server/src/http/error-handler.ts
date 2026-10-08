import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import type { ApiErrorCode } from '@raptix/web-contracts';

export interface ApiErrorBody {
  readonly statusCode: number;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

function statusCodeToCode(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'too_many_requests';
    case 503:
      return 'unavailable';
    default:
      return 'internal_error';
  }
}

export function apiErrorBody(statusCode: number, message: string, details?: unknown): ApiErrorBody {
  return {
    statusCode,
    error: {
      code: statusCodeToCode(statusCode),
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .status(404)
      .send(apiErrorBody(404, `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler(
    (error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
      const statusCode = error.statusCode ?? 500;
      let message: string;
      if (statusCode >= 500) {
        message = 'Internal server error';
      } else if (statusCode === 400) {
        message = 'Request validation failed';
      } else {
        message = error.message;
      }
      return reply.status(statusCode).send(apiErrorBody(statusCode, message));
    },
  );
}
