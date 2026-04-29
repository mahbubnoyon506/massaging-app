import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from '../redis/redis.module';
import { RedisKeys, PubSubChannels } from '../redis/redis.keys';

interface SocketMeta {
  username: string;
  roomId: string;
}

@Injectable()
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly sub: Redis,
  ) {}

  afterInit() {
    // Subscribe once to all room channels dynamically via pattern
    this.sub.psubscribe('pubsub:room:*:message', 'pubsub:room:*:deleted');
    this.sub.on('pmessage', (_pattern, channel, message) => {
      this.handlePubSubMessage(channel, message);
    });
  }

  private handlePubSubMessage(channel: string, message: string) {
    // pubsub:room:<roomId>:message
    const msgMatch = channel.match(/^pubsub:room:(.+):message$/);
    if (msgMatch) {
      const roomId = msgMatch[1];
      const payload = JSON.parse(message);
      // Broadcast message:new to all sockets in this room (on this instance)
      this.server.to(`room:${roomId}`).emit('message:new', {
        id: payload.id,
        username: payload.username,
        content: payload.content,
        createdAt: payload.createdAt,
      });
      return;
    }

    // pubsub:room:<roomId>:deleted
    const delMatch = channel.match(/^pubsub:room:(.+):deleted$/);
    if (delMatch) {
      const roomId = delMatch[1];
      const payload = JSON.parse(message);
      this.server.to(`room:${roomId}`).emit('room:deleted', { roomId: payload.roomId });
    }
  }

  async handleConnection(client: Socket) {
    const token = client.handshake.query['token'] as string;
    const roomId = client.handshake.query['roomId'] as string;

    // Validate token
    if (!token) {
      client.emit('error', { code: 401, message: 'Missing or expired session token' });
      client.disconnect(true);
      return;
    }

    const sessionRaw = await this.redis.get(RedisKeys.session(token));
    if (!sessionRaw) {
      client.emit('error', { code: 401, message: 'Missing or expired session token' });
      client.disconnect(true);
      return;
    }

    const session = JSON.parse(sessionRaw) as { userId: string; username: string };

    // Validate room
    if (!roomId) {
      client.emit('error', { code: 404, message: 'Room not found' });
      client.disconnect(true);
      return;
    }

    // We verify room existence via an existence key pattern
    // (We check via the rooms service indirectly using the DB — but gateway has no DB access.
    //  Use a lightweight approach: attempt to check via a stored key or just trust roomId format.
    //  The proper check: use a Redis key set when rooms are created, or just do a DB check.)
    // For correctness per spec, we check using Drizzle — injected via a service.
    // However, to keep gateway clean, we call validateRoom which is passed in.
    const roomExists = await this.checkRoomExists(roomId);
    if (!roomExists) {
      client.emit('error', { code: 404, message: 'Room not found' });
      client.disconnect(true);
      return;
    }

    const { username } = session;

    // Store connection metadata in Redis (not in-memory)
    const multi = this.redis.multi();
    multi.set(RedisKeys.socketUser(client.id), username, 'EX', 86400);
    multi.set(RedisKeys.socketRoom(client.id), roomId, 'EX', 86400);
    multi.sadd(RedisKeys.activeUsers(roomId), username);
    await multi.exec();

    // Join the socket.io room
    client.join(`room:${roomId}`);

    // Get current active users
    const activeUsers = await this.redis.smembers(RedisKeys.activeUsers(roomId));

    // Emit room:joined to THIS client only
    client.emit('room:joined', { activeUsers });

    // Broadcast room:user_joined to ALL OTHER clients
    client.to(`room:${roomId}`).emit('room:user_joined', {
      username,
      activeUsers,
    });
  }

  async handleDisconnect(client: Socket) {
    await this.cleanupSocket(client);
  }

  @SubscribeMessage('room:leave')
  async handleLeave(client: Socket) {
    await this.cleanupSocket(client);
    client.disconnect(true);
  }

  private async cleanupSocket(client: Socket) {
    const username = await this.redis.get(RedisKeys.socketUser(client.id));
    const roomId = await this.redis.get(RedisKeys.socketRoom(client.id));

    if (!username || !roomId) return;

    const multi = this.redis.multi();
    multi.del(RedisKeys.socketUser(client.id));
    multi.del(RedisKeys.socketRoom(client.id));
    multi.srem(RedisKeys.activeUsers(roomId), username);
    await multi.exec();

    const remaining = await this.redis.smembers(RedisKeys.activeUsers(roomId));

    client.to(`room:${roomId}`).emit('room:user_left', {
      username,
      activeUsers: remaining,
    });
  }

  private async checkRoomExists(roomId: string): Promise<boolean> {
    // Check via the Redis active-user key existence hint, or always pass through
    // and let the WS client get a real-time error. For strict compliance we use
    // a separate "rooms:exists" set maintained by the RoomsService.
    const exists = await this.redis.sismember('rooms:all', roomId);
    return exists === 1;
  }

  onModuleDestroy() {
    this.sub.punsubscribe('pubsub:room:*:message', 'pubsub:room:*:deleted');
  }
}
