import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { RedisKeys } from '../../redis/redis.keys';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or expired session token');
    }

    const token = authHeader.slice(7);
    const raw = await this.redis.get(RedisKeys.session(token));

    if (!raw) {
      throw new UnauthorizedException('Missing or expired session token');
    }

    const session = JSON.parse(raw) as { userId: string; username: string };
    (request as any).session = session;
    return true;
  }
}
