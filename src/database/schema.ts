import { pgTable, varchar, timestamp, text, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: varchar('id', { length: 32 }).primaryKey(),
  username: varchar('username', { length: 24 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rooms = pgTable('rooms', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 32 }).notNull().unique(),
  createdBy: varchar('created_by', { length: 24 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: varchar('id', { length: 32 }).primaryKey(),
    roomId: varchar('room_id', { length: 32 })
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    username: varchar('username', { length: 24 }).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roomCreatedAtIdx: index('messages_room_created_at_idx').on(t.roomId, t.createdAt),
  }),
);

export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Message = typeof messages.$inferSelect;
