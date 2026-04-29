# Anonymous Chat API

A real-time group chat service built with NestJS, PostgreSQL (Drizzle ORM), Redis, and Socket.io. Users identify by username only — no passwords, no registration.

## Stack

- **NestJS** — application framework
- **PostgreSQL + Drizzle ORM** — persistent storage
- **Redis** — session storage, active user tracking, WebSocket pub/sub scaling
- **Socket.io** — real-time messaging gateway

---

## Prerequisites

- Node.js 20+
- Docker & Docker Compose (for local Postgres + Redis)
- npm

---

## Quick Start (Local)

### 1. Clone & install

```bash
git clone https://github.com/mahbubnoyon506/massaging-app
cd anon-chat
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env if your DB/Redis ports differ
```

Default `.env`:

```
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432
REDIS_URL=redis://localhost:6379
```

### 3. Start infrastructure

```bash
docker-compose up postgres redis -d
```

### 4. Run the app

```bash
# Development (watch mode)
npm run start:dev

# Production build
npm run build
npm run start
```

The app runs migrations automatically on startup. No separate migration step needed.

---

## Docker (Full Stack)

Run everything in containers:

```bash
docker-compose up --build
```

App will be available at `http://localhost:3000`.

---

## Running Migrations Manually

Migrations run automatically on `npm run start`. To run them manually:

```bash
npm run db:migrate
```

To generate new migrations after schema changes:

```bash
npm run db:generate
```

---

## API Base URL

```
http://localhost:3000/api/v1
```

All endpoints (except `POST /login`) require:

```
Authorization: Bearer <sessionToken>
```

---

## WebSocket Connection

```
ws://localhost:3000/chat?token=<sessionToken>&roomId=<roomId>
```

---

## Project Structure

```
src/
├── main.ts                  # Bootstrap + migration runner
├── app.module.ts            # Root module
├── database/
│   ├── schema.ts            # Drizzle schema (users, rooms, messages)
│   ├── database.module.ts   # Drizzle provider (global)
│   └── migrate.ts           # Migration runner
├── redis/
│   ├── redis.module.ts      # Two Redis clients (data + subscriber)
│   └── redis.keys.ts        # Key helpers & pub/sub channel names
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts   # POST /login
│   └── dto/login.dto.ts
├── rooms/
│   ├── rooms.module.ts
│   ├── rooms.controller.ts  # REST room & message endpoints
│   ├── rooms.service.ts     # Business logic
│   └── dto/
├── chat/
│   ├── chat.module.ts
│   └── chat.gateway.ts      # Socket.io gateway + Redis pub/sub subscriber
└── common/
    ├── decorators/
    ├── exceptions/
    ├── filters/
    ├── guards/
    └── interfaces/
```
