import {
  Controller,
  Post,
  Body,
  Inject,
  HttpCode,
} from '@nestjs/common';
import { InjectDrizzle } from '../common/decorators/inject-drizzle.decorator';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RedisKeys, SESSION_TTL_SECONDS } from '../redis/redis.keys';
import { LoginDto } from './dto/login.dto';
import { nanoid } from 'nanoid';
import { ApiResponse } from '../common/interfaces/api-response.interface';

@Controller('api/v1')
export class AuthController {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto): Promise<ApiResponse> {
    const { username } = dto;

    // Find or create user
    let user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .then((rows) => rows[0] ?? null);

    if (!user) {
      const id = `usr_${nanoid(8)}`;
      const [created] = await this.db
        .insert(schema.users)
        .values({ id, username })
        .returning();
      user = created;
    }

    // Generate fresh session token and store in Redis
    const sessionToken = nanoid(40);
    const sessionData = JSON.stringify({ userId: user.id, username: user.username });
    await this.redis.setex(
      RedisKeys.session(sessionToken),
      SESSION_TTL_SECONDS,
      sessionData,
    );

    return {
      success: true,
      data: {
        sessionToken,
        user: {
          id: user.id,
          username: user.username,
          createdAt: user.createdAt,
        },
      },
    };
  }
}
