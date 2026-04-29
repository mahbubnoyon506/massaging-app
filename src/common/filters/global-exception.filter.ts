import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let code: string;
      let message: string;

      // Handle our custom AppException format
      if (
        typeof exceptionResponse === 'object' &&
        'code' in exceptionResponse &&
        'message' in exceptionResponse
      ) {
        code = (exceptionResponse as any).code;
        message = (exceptionResponse as any).message;
      } else if (exception instanceof BadRequestException) {
        code = 'VALIDATION_ERROR';
        const res = exceptionResponse as any;
        message =
          res?.message instanceof Array ? res.message[0] : res?.message ?? 'Validation failed';
      } else if (exception instanceof UnauthorizedException) {
        code = 'UNAUTHORIZED';
        message = 'Missing or expired session token';
      } else if (exception instanceof ForbiddenException) {
        code = 'FORBIDDEN';
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : (exceptionResponse as any)?.message ?? 'Forbidden';
      } else if (exception instanceof NotFoundException) {
        code = 'NOT_FOUND';
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : (exceptionResponse as any)?.message ?? 'Not found';
      } else if (exception instanceof ConflictException) {
        code = 'CONFLICT';
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : (exceptionResponse as any)?.message ?? 'Conflict';
      } else if (exception instanceof UnprocessableEntityException) {
        code = 'UNPROCESSABLE_ENTITY';
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : (exceptionResponse as any)?.message ?? 'Unprocessable entity';
      } else {
        code = 'HTTP_ERROR';
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : (exceptionResponse as any)?.message ?? exception.message;
      }

      return response.status(status).json({ success: false, error: { code, message } });
    }

    // Unexpected error
    console.error('[Unhandled]', exception);
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
