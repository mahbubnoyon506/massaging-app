import {
  HttpException,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

export class AppException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ code, message }, status);
  }

  static roomNotFound(id: string) {
    return new AppException(
      HttpStatus.NOT_FOUND,
      'ROOM_NOT_FOUND',
      `Room with id ${id} does not exist`,
    );
  }

  static roomNameTaken() {
    return new AppException(
      HttpStatus.CONFLICT,
      'ROOM_NAME_TAKEN',
      'A room with this name already exists',
    );
  }

  static forbidden(message: string) {
    return new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }

  static messageTooLong() {
    return new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'MESSAGE_TOO_LONG',
      'Message content must not exceed 1000 characters',
    );
  }

  static messageEmpty() {
    return new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'MESSAGE_EMPTY',
      'Message content must not be empty',
    );
  }
}
