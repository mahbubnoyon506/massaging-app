import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface SessionUser {
  userId: string;
  username: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.session as SessionUser;
  },
);
