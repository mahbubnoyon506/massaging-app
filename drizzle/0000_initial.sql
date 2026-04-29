CREATE TABLE IF NOT EXISTS "users" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "username" varchar(24) NOT NULL UNIQUE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "rooms" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "name" varchar(32) NOT NULL UNIQUE,
  "created_by" varchar(24) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "room_id" varchar(32) NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "username" varchar(24) NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "messages_room_created_at_idx"
  ON "messages" ("room_id", "created_at");
