export const RedisKeys = {
  session: (token: string) => `session:${token}`,
  activeUsers: (roomId: string) => `room:${roomId}:active_users`,
  socketUser: (socketId: string) => `socket:${socketId}:user`,
  socketRoom: (socketId: string) => `socket:${socketId}:room`,
} as const;

export const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export const PubSubChannels = {
  roomMessage: (roomId: string) => `pubsub:room:${roomId}:message`,
  roomDeleted: (roomId: string) => `pubsub:room:${roomId}:deleted`,
} as const;
