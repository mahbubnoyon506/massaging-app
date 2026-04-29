# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Client(s)                            │
│           HTTP REST          WebSocket /chat             │
└──────────┬──────────────────────────┬────────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│                  NestJS Application                       │
│                                                          │
│  ┌───────────────────┐    ┌──────────────────────────┐  │
│  │  REST Controllers  │    │   Socket.io Gateway      │  │
│  │  /api/v1/...      │    │   namespace: /chat        │  │
│  └────────┬──────────┘    └────────────┬─────────────┘  │
│           │                            │                  │
│  ┌────────▼──────────┐    ┌────────────▼─────────────┐  │
│  │   RoomsService    │    │   Redis pub/sub listener  │  │
│  │   AuthController  │    │   (psubscribe pattern)    │  │
│  └────────┬──────────┘    └────────────┬─────────────┘  │
└───────────┼────────────────────────────┼─────────────────┘
            │                            │
     ┌──────▼──────┐             ┌───────▼──────┐
     │ PostgreSQL  │             │    Redis      │
     │ (Drizzle)   │             │  - sessions  │
     │             │             │  - active    │
     │  users      │             │    users     │
     │  rooms      │             │  - socket    │
     │  messages   │             │    state     │
     └─────────────┘             │  - pub/sub   │
                                 └──────────────┘
```

### Multi-instance fan-out

```
  POST /rooms/:id/messages
         │
         ▼
   RoomsService.postMessage()
         │  persists to Postgres
         │
         ▼
   redis.publish("pubsub:room:<id>:message", payload)
         │
         ├──────────────────────────────────────┐
         ▼                                       ▼
  Instance A                             Instance B
  ChatGateway.pmessage()                ChatGateway.pmessage()
         │                                       │
  server.to("room:<id>")                server.to("room:<id>")
    .emit("message:new")                  .emit("message:new")
         │                                       │
  Clients on A                         Clients on B
```

---

## Session Strategy

**Token generation:** `nanoid(40)` — 40 URL-safe random characters (~238 bits of entropy). Opaque to the client.

**Storage:** `session:<token>` → `{ userId, username }` stored as JSON in Redis with a 24-hour TTL (`SETEX`).

**Validation:** Every REST request (except `POST /login`) passes through `AuthGuard`, which reads `Authorization: Bearer <token>`, looks up `session:<token>` in Redis, and attaches the session payload to `request.session`. Missing or expired keys return `401`.

**WebSocket auth:** The gateway reads `token` from the socket handshake query string, performs the same Redis lookup on `handleConnection`, and immediately disconnects with an error code if the token is missing or expired.

**Refresh:** Logging in with an existing username issues a new token (old tokens remain valid until they expire). This is intentional — it allows multiple concurrent sessions.

---

## Redis Pub/Sub WebSocket Fan-out

The problem: a REST `POST /rooms/:id/messages` request can arrive at **any** server instance. The WebSocket clients connected to the same room may be on **different** instances. A direct `server.emit()` from the REST controller would only reach clients on that one instance.

**Solution: Redis pub/sub decoupling**

1. `RoomsService.postMessage()` publishes the message payload to `pubsub:room:<roomId>:message`.
2. **Every** running instance has a `REDIS_SUBSCRIBER` client that `PSUBSCRIBE`s to `pubsub:room:*:message` and `pubsub:room:*:deleted`.
3. Each instance's `ChatGateway.handlePubSubMessage()` receives the event and emits `message:new` to its local Socket.io room — reaching all clients connected to that instance.

Room deletion follows the same pattern via `pubsub:room:<roomId>:deleted`.

**Why a separate Redis subscriber client?** A Redis client in `SUBSCRIBE` or `PSUBSCRIBE` mode cannot issue other commands. The subscriber (`REDIS_SUBSCRIBER`) is dedicated to pub/sub; the main client (`REDIS_CLIENT`) handles all other operations.

---

## Active User Tracking

- **Redis Sets** — `room:<roomId>:active_users` holds the set of usernames currently in a room.
- On socket connect: `SADD room:<roomId>:active_users <username>`
- On socket disconnect or `room:leave`: `SREM room:<roomId>:active_users <username>`
- `GET /rooms` and `GET /rooms/:id` call `SCARD` for a live count.

**Socket connection state** is stored in Redis (not in-memory JS maps):
- `socket:<socketId>:user` → username
- `socket:<socketId>:room` → roomId

This means on disconnect, any instance can look up what user/room the socket belonged to — a prerequisite for multi-instance correctness.

---

## Estimated Concurrent User Capacity (Single Instance)

**Assumptions:**
- Node.js 20, 2 vCPU / 4 GB RAM (e.g. Render Starter)
- Each WebSocket connection: ~10–15 KB RAM for socket state + socket.io overhead
- Redis round-trips: ~1–2 ms (same datacenter)
- Average message rate: 1 msg/sec per active room, not per user

**Memory:**
- 4 GB RAM, ~500 MB for Node.js + NestJS overhead → ~3.5 GB usable
- At 15 KB/connection: **~230,000 connections** before memory exhaustion

**CPU / Event loop:**
- Node.js is single-threaded. Heavy concurrent operations matter more than raw connections.
- Redis pub/sub callbacks are lightweight (JSON parse + socket.io emit).
- Realistically, the event loop saturates before memory does.
- Practical comfortable limit: **5,000–10,000 concurrent connections** with active message traffic, ~20,000 mostly-idle connections.

**Bottlenecks at this scale:**
- Postgres connection pool (default 10) — queries queue under heavy load
- Redis latency under high publish rates

---

## Scaling to 10× Load (~50,000–100,000 concurrent users)

| Change | Reason |
|---|---|
| **Horizontal scaling** (3–5 app instances behind a load balancer with sticky sessions or `@socket.io/redis-adapter`) | Distribute WebSocket connections across cores/machines |
| **Increase Postgres pool** + use a connection pooler (PgBouncer) | Avoid connection starvation at high query rates |
| **Redis Cluster** | Distribute key space, avoid single-node bottleneck for pub/sub |
| **Message fan-out via `@socket.io/redis-adapter`** | Replace manual pub/sub with the official adapter, which handles room routing across instances natively |
| **Rate limiting** (per-user message rate) | Prevent hot rooms from flooding pub/sub |
| **Read replicas for message history** | `GET /rooms/:id/messages` is read-heavy; offload to replica |
| **CDN / reverse proxy** (nginx) | TLS termination, connection keep-alive, static buffering |

The current pub/sub design **already supports horizontal scaling** — the main missing piece is the `@socket.io/redis-adapter` for proper multi-instance socket room routing (currently, `server.to("room:X")` only targets sockets on the local instance; pub/sub compensates for this but adding the adapter makes it fully native).

---

## Known Limitations & Trade-offs

**1. No deduplication of active users per socket**
If the same username opens two WebSocket connections to the same room, `SADD` is a no-op (correct) but `SREM` on first disconnect removes them from the active set even though they're still connected on the second socket. Fix: use a Redis Hash mapping `username → connection count` instead of a Set.

**2. Cursor-based pagination is approximate**
The `before` cursor filters by `createdAt` timestamp comparison in application code rather than via a DB index seek. For rooms with many messages posted at the exact same millisecond, ordering within that timestamp group is by `id` lexicographic sort (not insertion order). A production fix: add a monotonic `sequence` column.

**3. Session tokens are not revocable individually by the user**
There is no logout endpoint. Tokens expire after 24 hours. Multiple active sessions per user are allowed by design (idempotent login). A logout endpoint would `DEL session:<token>` from Redis.

**4. No message delivery acknowledgment**
`message:new` is a fire-and-forget Socket.io emit. If a client is briefly disconnected and reconnects, it will miss messages sent during the gap. Clients should fetch recent history on reconnect.

**5. `rooms:all` Redis set can drift**
On a fresh Redis restart, `rooms:all` is repopulated from Postgres in `RoomsService.onModuleInit()`. However, if multiple instances start simultaneously, the repopulation is idempotent (`SADD` is safe). This is a minor startup race, not a correctness issue.

**6. No horizontal socket routing without the Redis adapter**
`server.to("room:X").emit(...)` in the gateway only targets clients connected to the *local* instance. The pub/sub pattern compensates: every instance subscribes and re-emits locally. However, this means each instance processes every pub/sub message regardless of whether it has clients in that room. Adding `@socket.io/redis-adapter` would make routing efficient and is the recommended production upgrade.
