import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, desc } from 'drizzle-orm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RedisKeys, PubSubChannels } from '../redis/redis.keys';
import { AppException } from '../common/exceptions/app.exception';
import { nanoid } from 'nanoid';
import { InjectDrizzle } from '../common/decorators/inject-drizzle.decorator';

@Injectable()
export class RoomsService {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Sync rooms:all set from DB on startup */
  async onModuleInit() {
    const rooms = await this.db.select({ id: schema.rooms.id }).from(schema.rooms);
    if (rooms.length > 0) {
      await this.redis.sadd('rooms:all', ...rooms.map((r) => r.id));
    }
  }

  async findAll() {
    const rooms = await this.db.select().from(schema.rooms);

    const roomsWithActiveUsers = await Promise.all(
      rooms.map(async (room) => ({
        id: room.id,
        name: room.name,
        createdBy: room.createdBy,
        activeUsers: await this.redis.scard(RedisKeys.activeUsers(room.id)),
        createdAt: room.createdAt,
      })),
    );

    return { rooms: roomsWithActiveUsers };
  }

  async findOne(id: string) {
    const room = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id))
      .then((rows) => rows[0] ?? null);

    if (!room) throw AppException.roomNotFound(id);

    const activeUsers = await this.redis.scard(RedisKeys.activeUsers(id));

    return {
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      activeUsers,
      createdAt: room.createdAt,
    };
  }

  async create(name: string, username: string) {
    const existing = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.name, name))
      .then((rows) => rows[0] ?? null);

    if (existing) throw AppException.roomNameTaken();

    const id = `room_${nanoid(8)}`;
    const [room] = await this.db
      .insert(schema.rooms)
      .values({ id, name, createdBy: username })
      .returning();

    // Register room id in the global set for WS gateway validation
    await this.redis.sadd('rooms:all', id);

    return {
      id: room.id,
      name: room.name,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
    };
  }

  async remove(id: string, username: string, redis: Redis) {
    const room = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, id))
      .then((rows) => rows[0] ?? null);

    if (!room) throw AppException.roomNotFound(id);

    if (room.createdBy !== username) {
      throw AppException.forbidden('Only the room creator can delete this room');
    }

    // Publish deletion event BEFORE deleting from DB so WS gateway can broadcast
    await redis.publish(
      PubSubChannels.roomDeleted(id),
      JSON.stringify({ roomId: id }),
    );

    await this.db.delete(schema.rooms).where(eq(schema.rooms.id, id));

    // Cleanup Redis keys
    const multi = this.redis.multi();
    multi.del(RedisKeys.activeUsers(id));
    multi.srem('rooms:all', id);
    await multi.exec();

    return { deleted: true };
  }

  async getMessages(roomId: string, limit: number, before?: string) {
    const room = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .then((rows) => rows[0] ?? null);

    if (!room) throw AppException.roomNotFound(roomId);

    const safeLimit = Math.min(limit, 100);

    // Fetch messages newest-first (we'll reverse at the end for chronological order)
    const allRows = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.roomId, roomId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(safeLimit + 1);

    let rows = allRows;

    if (before) {
      const cursor = await this.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, before))
        .then((r) => r[0] ?? null);

      if (cursor) {
        const cursorTime = cursor.createdAt.getTime();
        rows = allRows.filter(
          (m) =>
            m.createdAt.getTime() < cursorTime ||
            (m.createdAt.getTime() === cursorTime && m.id < before),
        );
      }
    }

    const hasMore = rows.length > safeLimit;
    const page = rows.slice(0, safeLimit);

    const messages = page
      .slice()
      .reverse()
      .map((m) => ({
        id: m.id,
        roomId: m.roomId,
        username: m.username,
        content: m.content,
        createdAt: m.createdAt,
      }));

    const nextCursor = hasMore ? messages[0].id : null;

    return { messages, hasMore, nextCursor };
  }

  async postMessage(roomId: string, username: string, content: string, redis: Redis) {
    const room = await this.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .then((rows) => rows[0] ?? null);

    if (!room) throw AppException.roomNotFound(roomId);

    const trimmed = content.trim();
    if (!trimmed) throw AppException.messageEmpty();
    if (trimmed.length > 1000) throw AppException.messageTooLong();

    const id = `msg_${nanoid(8)}`;
    const [message] = await this.db
      .insert(schema.messages)
      .values({ id, roomId, username, content: trimmed })
      .returning();

    const payload = {
      id: message.id,
      roomId: message.roomId,
      username: message.username,
      content: message.content,
      createdAt: message.createdAt,
    };

    // Publish to Redis pub/sub — WS gateway subscribers pick this up
    await redis.publish(PubSubChannels.roomMessage(roomId), JSON.stringify(payload));

    return payload;
  }
}
