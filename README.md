# Quote-Hub REST API (`quote-hub-api`)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg?style=flat-square&logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express-4.21-lightgrey.svg?style=flat-square&logo=express)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791.svg?style=flat-square&logo=postgresql)](https://www.postgresql.org/)
[![Prisma ORM](https://img.shields.io/badge/Prisma-5.20-2D3748.svg?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-7+-DC382D.svg?style=flat-square&logo=redis)](https://redis.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-6.3-orange.svg?style=flat-square)](https://bullmq.io/)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-6BA539.svg?style=flat-square&logo=openapiinitiative)](http://localhost:4000/docs)
[![Tests](https://img.shields.io/badge/tests-600%2B%20passing-success.svg?style=flat-square&logo=vitest)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

Production-grade, modular monolith backend REST API powering **Quote-Hub** — a quote-centric social web application. Engineered with strict domain boundaries, controller-service-repository layering, transactional consistency, outbox-driven asynchronous background workers, and RFC 9457 error contracts.

---

## Table of Contents

- [Architectural Highlights](#architectural-highlights)
- [Architecture & Request Lifecycle](#architecture--request-lifecycle)
- [Directory Structure](#directory-structure)
- [Domain Modules](#domain-modules)
  - [Authentication & Identity](#authentication--identity)
  - [Quotes & Theming](#quotes--theming)
  - [Social Graph & Interactions](#social-graph--interactions)
  - [Discovery, Feeds & Search](#discovery-feeds--search)
  - [Notifications & Outbox Workers](#notifications--outbox-workers)
  - [Governance & Administration](#governance--administration)
- [Core Invariants & Design Decisions](#core-invariants--design-decisions)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Configuration](#environment-configuration)
  - [Starting Infrastructure Services (PostgreSQL & Redis)](#starting-infrastructure-services-postgresql--redis)
  - [Database Setup, Migrations & Seeding](#database-setup-migrations--seeding)
  - [Running the Application](#running-the-application)
- [Background Workers & Scheduled Jobs](#background-workers--scheduled-jobs)
- [API Documentation & Standards](#api-documentation--standards)
  - [Interactive Swagger UI](#interactive-swagger-ui)
  - [Health Checks](#health-checks)
  - [API Endpoints Overview](#api-endpoints-overview)
  - [RFC 9457 Problem Details](#rfc-9457-problem-details)
  - [Idempotent Mutations](#idempotent-mutations)
- [Observability & Security](#observability--security)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Environment Variables Reference](#environment-variables-reference)

---

## Architectural Highlights

- **Modular Monolith Architecture**: Clean separation into domain modules (`auth`, `users`, `quotes`, `themes`, `likes`, `reposts`, `bookmarks`, `follows`, `feeds`, `trending`, `search`, `notifications`, `admin`) preventing spaghetti dependencies.
- **Layered Clean Design**: Explicit four-layer flow: **Routes $\rightarrow$ Controllers $\rightarrow$ Services $\rightarrow$ Repositories $\rightarrow$ Prisma/PostgreSQL**.
- **Transactional Outbox Pattern**: Social and domain mutations stage event records into an `outbox_events` table atomically within the primary PostgreSQL transaction. An outbox polling worker utilizes PostgreSQL `FOR UPDATE SKIP LOCKED` for concurrent, safe event distribution into BullMQ queues without dual-write inconsistencies.
- **Strict Domain Invariants**: Enforces core domain rules at both the application (Zod) and database (PostgreSQL constraints) layers:
  - Quote length strictly capped at 280 Unicode characters (using code-point array spreading to match PostgreSQL `char_length`).
  - Attribution Invariant: Original quotes (`isOriginal: true`) strictly forbid an `authorName`.
  - Social relational invariants: Self-likes and self-follows are prevented.
  - Counter protection: Atomic decrements and PostgreSQL `CHECK` constraints guarantee non-negative social counters (`GREATEST(count - 1, 0)`).
- **Dual-Strategy Social Feeds**:
  - **Following Feed**: Reverse-chronological feed powered by optimized SQL candidate joins and time-based composite cursor pagination `(createdAt, id)`.
  - **For You Feed**: Discovery feed accelerated via Redis sorted sets with automated graceful degradation to PostgreSQL when Redis is unavailable.
- **Fuzzy Search Engine**: PostgreSQL `pg_trgm` trigram similarity matching over quotes and user handles backed by GIN indexes.
- **UUIDv7 Primary Keys**: Time-ordered, monotonic UUIDv7 identifiers providing B-tree index insertion locality and sorting efficiency without exposing auto-increment integer IDs.
- **RFC 9457 Problem Details**: Standardized HTTP API error responses (`application/problem+json`) with domain-specific error codes and field-level validation breakdowns.
- **Database-Backed Idempotency**: Support for client-supplied `Idempotency-Key` headers on mutations, validating SHA-256 payload digests to eliminate duplicate writes from network retries.

---

## Architecture & Request Lifecycle

```mermaid
flowchart TD
    Client(["HTTP Client / Next.js Web App"])

    subgraph HTTP_Layer ["HTTP & Middleware Pipeline"]
        SecMW["Helmet & CORS Middleware"]
        CtxMW["Request Context (UUIDv7 Trace ID)"]
        RateMW["Rate Limiter (Token Bucket / Redis)"]
        AuthMW["Better Auth Session Resolution"]
        IdempMW["Idempotency Middleware (SHA-256 Hash)"]
    end

    subgraph Module_Layer ["Modular Monolith Architecture"]
        Router["Express Router (/api/v1/*)"]
        Controller["Domain Controller (Input Validation)"]
        Service["Domain Service (Business Logic)"]
        Repo["Domain Repository (Query Layer)"]
    end

    subgraph Data_Tier ["Data & Caching Tier"]
        Postgres[("PostgreSQL 16+\nPrimary Source of Truth")]
        RedisDB[("Redis 7+\nCache, Rate Limits & BullMQ")]
    end

    subgraph Async_Workers ["Asynchronous Background Workers"]
        OutboxPoller["Outbox Poller\n(FOR UPDATE SKIP LOCKED)"]
        BullMQQueues["BullMQ Queues"]
        NotifWorker["Notifications Worker"]
        MediaWorker["Media / Sharp Avatar Worker"]
        TrendingWorker["Trending Recalculation Worker"]
        AnalyticsWorker["Daily Metrics Rollup Worker"]
        PurgeWorker["User Cleanup Worker"]
    end

    subgraph External_Services ["External Services"]
        R2["Cloudflare R2 (S3 API)"]
        Resend["Resend Email Service"]
        Sentry["Sentry Error Tracking"]
        OTel["OpenTelemetry OTLP Collector"]
    end

    Client --> SecMW --> CtxMW --> RateMW --> AuthMW --> IdempMW --> Router
    Router --> Controller --> Service --> Repo
    Repo --> Postgres
    Service -.-> RedisDB
    Service -->|Staged Event| Postgres

    Postgres --> OutboxPoller --> BullMQQueues
    BullMQQueues --> NotifWorker --> Postgres
    BullMQQueues --> MediaWorker --> R2
    BullMQQueues --> TrendingWorker --> RedisDB
    BullMQQueues --> AnalyticsWorker --> Postgres
    BullMQQueues --> PurgeWorker --> Postgres

    CtxMW -.-> OTel
    Router -.-> Sentry
    Service -.-> Resend
```

---

## Directory Structure

```text
quote-hub-api/
├── prisma/
│   ├── schema.prisma            # Declarative schema (Better Auth + Domain models + Outbox)
│   └── seed.ts                  # Deterministic database seeder for test & demo environments
├── src/
│   ├── app/
│   │   ├── config/              # Zod-validated environment configuration (env.ts)
│   │   ├── controllers/         # Root controllers (health check probes)
│   │   ├── routes/              # Base health routes (/health/live, /health/ready)
│   │   ├── app.ts               # Express application initialization & middleware assembly
│   │   └── server.ts            # HTTP server bootstrap with graceful shutdown handlers
│   ├── infrastructure/
│   │   ├── database/            # Prisma Client singleton with connection timeout ping
│   │   ├── docs/                # OpenAPI 3.1 specification & Swagger UI handler
│   │   ├── email/               # Resend transactional email client
│   │   ├── logging/             # Pino logger & Sentry SDK initialization
│   │   ├── queue/               # BullMQ connection factory & Transactional Outbox publisher
│   │   ├── redis/               # ioredis client with fallback & ioredis-mock support
│   │   ├── storage/             # Cloudflare R2 / AWS S3 presigned URL generator
│   │   └── telemetry/           # OpenTelemetry SDK auto-instrumentation & OTLP tracing
│   ├── middleware/
│   │   ├── auth.ts              # Better Auth session extraction & user context injection
│   │   ├── authorization.ts     # Role-based access control (ADMIN / USER) & ownership check
│   │   ├── error-handler.ts     # Terminal RFC 9457 Problem Details error handler
│   │   ├── idempotency.ts       # Per-user mutation deduplication with SHA-256 payload hashing
│   │   ├── rate-limit.ts        # Sliding window / token bucket rate limiters
│   │   ├── request-context.ts   # UUIDv7 correlation ID injection & propagation
│   │   └── security.ts          # Helmet security headers & CORS policy
│   ├── modules/
│   │   ├── admin/               # Moderation, account bans, audit logs, metrics dashboard
│   │   ├── auth/                # Better Auth engine & auth route bindings
│   │   ├── bookmarks/           # Private quote bookmarks collection
│   │   ├── feeds/               # Reverse-chronological Following feed & For You feed
│   │   ├── follows/             # Social follower graph maintenance
│   │   ├── likes/               # Atomic likes & counter increments
│   │   ├── media/               # Presigned avatar upload & Sharp image processing
│   │   ├── notifications/       # In-app notifications inbox & unread state
│   │   ├── quotes/              # Quotes CRUD, cursor pagination & validation
│   │   ├── reposts/             # Canonical quote reposting
│   │   ├── search/              # PostgreSQL pg_trgm fuzzy search
│   │   ├── themes/              # Visual quote theme catalog registry
│   │   ├── trending/            # 24h rolling window trending quote calculation
│   │   └── users/               # User profiles, avatar updates, soft-deletion
│   ├── shared/
│   │   ├── errors/              # RFC 9457 AppError subclasses (NotFound, Conflict, Forbidden, etc.)
│   │   └── utils/               # UUIDv7 generator, base64 cursor encoder, Zod helpers
│   └── workers/
│       ├── analytics.worker.ts  # Daily metrics rollup worker (00:05 cron)
│       ├── media.worker.ts      # Avatar download, WebP conversion & CDN upload worker
│       ├── notifications.worker.ts # In-app notification delivery worker
│       ├── outbox.worker.ts     # PostgreSQL Outbox polling daemon (SKIP LOCKED)
│       ├── runner.ts            # Unified background worker process supervisor
│       ├── trending.worker.ts   # Rolling trending score recalculator (every 5 mins)
│       └── user-cleanup.worker.ts # Purge worker for soft-deleted accounts (>30 days)
├── tests/
│   ├── integration/             # Supertest API endpoint & database integration tests
│   │   └── journeys/            # End-to-end user journey flows (publishing, social, admin)
│   └── unit/                    # Fast isolated unit tests for services, schemas & workers
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Domain Modules

### Authentication & Identity
- Powered by **Better Auth** with decoupled database models (`auth_user`, `auth_session`, `auth_account`, `auth_verification`) referencing domain `users` via foreign key.
- Supports email/password credentials and Google OAuth.
- Profile management with username uniqueness, bio constraints, and account soft-deletion (`deleted_at`).
- Avatars utilize a two-step presigned upload workflow:
  1. `POST /api/v1/users/me/avatar/presign` returns a Cloudflare R2 direct upload URL.
  2. `POST /api/v1/users/me/avatar/confirm` dispatches an avatar processing job to resize, strip metadata, and transcode the image to 400x400 WebP via Sharp.

### Quotes & Theming
- Quotes are bound to registered visual themes (`themes` catalog).
- Strict validation rules:
  - Length between 1 and 280 Unicode code points (properly counting multibyte emojis).
  - Attribution Invariant: `isOriginal: true` requires `authorName = null`. If `isOriginal: false`, `authorName` is optional (max 100 chars).
- Keyset cursor pagination over `(createdAt, id)` ensures $O(1)$ query execution even on deep result sets.

### Social Graph & Interactions
- **Likes**: Atomic database transactions enforce uniqueness (`uq_likes_user_quote`), update quote `like_count`, block self-likes, and emit `quote.liked` outbox events.
- **Reposts**: Support reposting canonical quotes with uniqueness enforcement, `repost_count` updates, and outbox event dispatching.
- **Bookmarks**: Private to each user, supporting efficient retrieval and removal without affecting public quote metrics.
- **Follows**: Bidirectional social graph edges (`follows` table) with non-negative `follower_count` / `following_count` maintenance and self-follow blocking.

### Discovery, Feeds & Search
- **Following Feed**: Reverse-chronological timeline of original quotes and reposts created by accounts the user follows, executed in a single parameterized SQL query.
- **For You Feed**: Redis-accelerated personalized discovery feed caching high-engagement quotes with seamless fallback to database ranking.
- **Trending Service**: 24-hour rolling popularity ranking calculated via an exponential decay algorithm combining likes, reposts, and quote recency:
  $$\text{Score} = \frac{\text{Likes} \times 1.0 + \text{Reposts} \times 2.0}{(\text{Age in Hours} + 2)^{1.5}}$$
- **Fuzzy Search Engine**: Leverages PostgreSQL `pg_trgm` extension for trigram similarity matching across quote bodies and user handles.

### Notifications & Outbox Workers
- Mutations never write directly to message queues. Instead, domain events (`quote.liked`, `quote.reposted`, `user.followed`) are saved to `outbox_events` within the primary database transaction.
- The Outbox worker polls unhandled events in batches using `SELECT ... FOR UPDATE SKIP LOCKED`, marking records as `PROCESSING` and routing them to BullMQ queues.
- In-app notification worker delivers alerts to recipients with deduplication and unread counter queries.

### Governance & Administration
- Role-based authorization (`USER` vs `ADMIN`).
- User moderation: Account suspension with reason and optional expiration (`suspendedUntil`), administrative account deletion.
- Quote moderation: Administrative soft-deletion (`deleted_at`) with audit log trail.
- Operational analytics: Real-time queries for platform health, plus daily metrics rollups (`daily_metrics`).
- Database counter reconciliation maintenance procedure to automatically resolve desynchronized counts.

---

## Core Invariants & Design Decisions

| Category | Invariant / Decision | Enforcement Mechanism |
| :--- | :--- | :--- |
| **Identifiers** | Monotonic UUIDv7 IDs for all primary keys | Native PostgreSQL `uuid` + application `uuidv7` generator |
| **Quote Length** | Maximum 280 Unicode characters | Zod `[...str].length` + PostgreSQL `char_length(text) <= 280` |
| **Attribution** | `isOriginal = true` $\iff$ `authorName = NULL` | Zod schema refinement + PostgreSQL table CHECK constraint |
| **Self-Interactions**| Users cannot like or follow themselves | Service-level verification + PostgreSQL CHECK constraints |
| **Counters** | Counters can never drop below zero | SQL atomic decrement `GREATEST(counter - 1, 0)` + CHECK constraints |
| **Entity Deletion** | Soft-delete for users/quotes; hard-delete for relations | `deleted_at` timestamp filtering in queries; cascade deletions on relationships |
| **Asynchronous Events** | At-least-once delivery; zero dual-write risk | Transactional Outbox pattern with `FOR UPDATE SKIP LOCKED` |
| **Cache Reliability**| Redis downtime must not take down the API | Redis try/catch wrappers falling back to PostgreSQL queries |

---

## Tech Stack

| Domain | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | [Node.js](https://nodejs.org/) (v20+ / v22 LTS) | High-performance asynchronous JavaScript engine |
| **Language** | [TypeScript 5.6](https://www.typescriptlang.org/) | Strict static type checking (`strict: true`, `noImplicitAny`) |
| **HTTP Framework** | [Express.js 4.21](https://expressjs.com/) | Lightweight, extensible HTTP web framework |
| **Database** | [PostgreSQL 16+](https://www.postgresql.org/) | ACID-compliant relational database & single source of truth |
| **ORM** | [Prisma 5.20](https://www.prisma.io/) | Type-safe schema modeling, migrations & database queries |
| **Authentication** | [Better Auth 1.7](https://www.better-auth.com/) | Modern session management, password hashing & OAuth flows |
| **Cache & Queue** | [Redis 7+](https://redis.io/) / [BullMQ 6.3](https://bullmq.io/) | High-throughput distributed caching & reliable background jobs |
| **Object Storage** | [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) / [AWS S3](https://aws.amazon.com/s3/) | S3-compatible asset storage for user avatars |
| **Image Processing** | [Sharp 0.35](https://sharp.pixelplumbing.com/) | High-speed image transcoding, resizing & WebP compression |
| **Email Delivery** | [Resend 6.32](https://resend.com/) | Developer-first transactional email provider |
| **Logging & Errors** | [Pino 9.4](https://getpino.io/) & [Sentry Node 11.6](https://sentry.io/) | Structured JSON logging & distributed error tracking |
| **Telemetry** | [OpenTelemetry 0.81](https://opentelemetry.io/) | Vendor-neutral distributed tracing and metrics |
| **API Validation** | [Zod 3.23](https://zod.dev/) | Runtime schema declaration and static type inference |
| **Documentation** | [Swagger UI](https://swagger.io/) / [OpenAPI 3.1](https://www.openapis.org/) | Interactive API reference documentation |
| **Testing** | [Vitest 2.1](https://vitest.dev/) & [Supertest 7.0](https://github.com/ladjs/supertest) | Fast ESM/TypeScript unit and integration test runner |

---

## Getting Started

### Prerequisites

Ensure you have the following installed on your host system:
- **Node.js**: `v20.0.0` or higher (`v22 LTS` recommended)
- **Container Engine (Recommended)**: [Docker](https://www.docker.com/) or [Podman](https://podman.io/) (for isolated PostgreSQL 16 & Redis 7 services)
- **PostgreSQL**: `16.0` or higher (if running natively without containers, requires `pg_trgm` extension)
- **Redis**: `7.0` or higher (if running natively without containers)

### Installation

Clone the repository and install the dependencies:

```bash
cd quote-hub-api
npm install
```

### Environment Configuration

Copy the example environment configuration file:

```bash
cp .env.example .env
```

Review and update the variables in `.env` to match your local setup:

```env
# Server Runtime
NODE_ENV=development
PORT=4000

# PostgreSQL Connection String
DATABASE_URL="postgresql://postgres:password@localhost:5432/quotehub_dev"

# Redis Cache & BullMQ Broker
REDIS_URL="redis://localhost:6379"

# Web Client Origin for CORS
FRONTEND_ORIGIN="http://localhost:3000"

# Better Auth Secret (min 32 characters) & Base URL
BETTER_AUTH_SECRET="your-secure-random-32-character-secret-key-here"
BETTER_AUTH_URL="http://localhost:4000"

# Cloudflare R2 / S3 Object Storage (Optional for local testing)
R2_ACCOUNT_ID="your-r2-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key"
R2_SECRET_ACCESS_KEY="your-r2-secret-key"
R2_BUCKET_NAME="quotehub-avatars"
R2_PUBLIC_URL="https://media.quote-hub.local"

# Sentry Monitoring & Resend Email (Optional for local testing)
SENTRY_DSN=""
RESEND_API_KEY=""
EMAIL_FROM="Quote-Hub <noreply@quote-hub.local>"
```

### Starting Infrastructure Services (PostgreSQL & Redis)

When setting up the project for the first time, spin up PostgreSQL 16 and Redis 7. You can use Docker Compose, Podman, or native system services:

#### Option A: Docker Compose / Podman Compose (Recommended)
From the repository root (`Quote-Hub/`):

```bash
# Using Docker Compose
docker compose up -d

# Or using Podman Compose
podman compose up -d
```

#### Option B: Standalone Podman / Docker Containers
If you prefer running standalone container instances directly:

```bash
# 1. Start PostgreSQL 16
podman run -d --name quotehub-postgres \
  --restart=always \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=quotehub_dev \
  -p 5432:5432 postgres:16-alpine

# 2. Start Redis 7
podman run -d --name quotehub-redis \
  --restart=always \
  -p 6379:6379 redis:7-alpine
```
*(Replace `podman` with `docker` if using Docker).*

#### Option C: Convenience npm Scripts
Once the containers have been initialized on your machine, you can control them from inside `quote-hub-api/`:

```bash
npm run services:start   # Starts quotehub-postgres and quotehub-redis
npm run services:status  # Checks container status and exposed ports
npm run services:stop    # Stops both containers
```

#### Creating the Test Database
The test suite (`npm test`) connects to `quotehub_test`. Create this database within your running PostgreSQL container before running tests:

```bash
# Using Podman:
podman exec quotehub-postgres psql -U postgres -c "CREATE DATABASE quotehub_test;"

# Or using Docker:
docker exec quotehub-postgres psql -U postgres -c "CREATE DATABASE quotehub_test;"
```

---

### Database Setup, Migrations & Seeding

Once the database server is running, apply the database schema migrations and seed the initial dataset:

1. **Apply Migrations to the Development Database:**
   ```bash
   npx prisma migrate deploy
   ```
   *(For rapid local prototyping, `npx prisma db push` is also available).*

2. **Apply Migrations to the Test Database:**
   ```bash
   DATABASE_URL="postgresql://postgres:password@localhost:5432/quotehub_test" npx prisma migrate deploy
   ```

3. **Verify Database Connectivity & Migration Status:**
   ```bash
   npx prisma migrate status
   ```

4. **Seed the Database with Initial Data:**
   ```bash
   npm run seed
   ```

   **Default Seed Credentials:**
   | Account | Email | Username | Role | Notes |
   | :--- | :--- | :--- | :--- | :--- |
   | **Administrator** | `admin@quote-hub.local` | `admin` | `ADMIN` | Platform administrator with full moderation access |
   | **Alice Smith** | `alice@quote-hub.local` | `alice` | `USER` | Active creator with original and attributed quotes |
   | **Bob Jones** | `bob@quote-hub.local` | `bob` | `USER` | Follows Alice, has likes and reposts |
   | **Charlie Brown** | `charlie@quote-hub.local` | `charlie` | `USER` | Active community member |
   | **Suspended User** | `spammer@quote-hub.local` | `spammer` | `USER` | Sample suspended account for moderation tests |

### Running the Application

#### 1. Start the HTTP API Server (Development Mode)
```bash
npm run dev
```
The server will boot with hot-reload enabled via `tsx` on `http://localhost:4000`.

#### 2. Start the Background Workers
In a separate terminal window, launch the unified background worker process:
```bash
npm run workers
```
This runs the outbox poller, BullMQ worker consumers, and registers recurring cron jobs.

#### 3. Build for Production
```bash
npm run build
npm start
```

---

## Background Workers & Scheduled Jobs

The background processing system is built on **BullMQ** and the **Transactional Outbox Pattern**:

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Client
    participant API as Express API
    participant DB as PostgreSQL
    participant Outbox as Outbox Poller
    participant Redis as BullMQ (Redis)
    participant Worker as Background Workers

    User->>API: POST /api/v1/quotes (Create Quote)
    rect rgb(240, 248, 255)
        Note over API,DB: Single PostgreSQL Transaction
        API->>DB: INSERT into quotes (...)
        API->>DB: INSERT into outbox_events (event_type: 'quote.created', ...)
    end
    API-->>User: 201 Created (Quote Payload)

    loop Polling Loop (Every 500ms)
        Outbox->>DB: SELECT * FROM outbox_events WHERE status='PENDING' FOR UPDATE SKIP LOCKED
        Outbox->>Redis: Enqueue Job to Target BullMQ Queue
        Outbox->>DB: UPDATE outbox_events SET status='PUBLISHED'
    end

    Redis->>Worker: Dispatch Job
    Worker->>DB: Process Asynchronous Projections (Feeds, Notifications)
```

### Registered Queues & Worker Tasks

| Queue Name | Job Name | Trigger / Frequency | Description |
| :--- | :--- | :--- | :--- |
| **`outbox-poller`** | `process-outbox` | Continuous loop (500ms interval) | Claims pending events in PostgreSQL using `FOR UPDATE SKIP LOCKED` and publishes them to BullMQ |
| **`notifications-queue`**| `process-notification` | Event-driven (`quote.liked`, `quote.reposted`, `user.followed`) | Inserts notification records and updates unread badge states |
| **`media-queue`** | `process-avatar` | Event-driven (`avatar.uploaded`) | Downloads original avatar, normalizes to 400x400 WebP via Sharp, uploads optimized file to R2 |
| **`trending-queue`** | `recalculate-trending` | Repeatable Cron: `*/5 * * * *` (Every 5 mins) | Computes 24h decay engagement scores and updates Redis trending sorted sets |
| **`analytics-queue`**| `aggregate-daily-metrics`| Repeatable Cron: `5 0 * * *` (Daily at 00:05 UTC) | Aggregates daily platform metrics into the `daily_metrics` table |
| **`user-cleanup-queue`**| `purge-deleted-accounts` | Scheduled daily | Permanently removes accounts soft-deleted for more than 30 days |

---

## API Documentation & Standards

### Interactive Swagger UI
Interactive OpenAPI 3.1 documentation is served directly by the backend:
- **Swagger UI**: [http://localhost:4000/docs](http://localhost:4000/docs)
- **OpenAPI JSON Spec**: Available programmatically in `src/infrastructure/docs/openapi.ts`.

### Health Checks
Designed for container orchestrators (Kubernetes / Docker Compose) and uptime monitors:
- **`GET /health/live`**: Process liveness probe. Returns HTTP 200 `{ status: "alive" }`.
- **`GET /health/ready`**: Dependency readiness probe. Tests the PostgreSQL connection pool. Returns HTTP 200 `{ status: "ready", services: { database: "healthy" } }` or HTTP 503 if degraded.

### API Endpoints Overview

#### Authentication (`/api/auth/*` & `/api/v1/auth/*`)
- `POST /api/auth/sign-in/email` — Email & password authentication
- `POST /api/auth/sign-up/email` — New user registration
- `POST /api/auth/sign-out` — Invalidate current session
- `GET /api/auth/get-session` — Retrieve active session and user info
- `POST /api/auth/sign-in/social` — Google OAuth authentication flow

#### Users (`/api/v1/users`)
- `GET /api/v1/users/me` — Retrieve current authenticated user profile
- `PATCH /api/v1/users/me` — Update display name, bio, or settings
- `DELETE /api/v1/users/me` — Soft-delete account
- `GET /api/v1/users/:username` — Retrieve public profile and stats
- `POST /api/v1/users/me/avatar/presign` — Obtain Cloudflare R2 presigned direct upload URL
- `POST /api/v1/users/me/avatar/confirm` — Confirm avatar upload and trigger background WebP optimization

#### Quotes & Themes (`/api/v1/quotes`, `/api/v1/themes`)
- `GET /api/v1/themes` — List all active visual quote themes
- `GET /api/v1/quotes` — Keyset cursor paginated list of public quotes
- `POST /api/v1/quotes` — Create new quote (supports `Idempotency-Key` header)
- `GET /api/v1/quotes/:id` — Retrieve quote details with author & theme
- `PATCH /api/v1/quotes/:id` — Update quote text or visual theme (owner only)
- `DELETE /api/v1/quotes/:id` — Soft-delete quote (owner or admin)
- `GET /api/v1/quotes/users/:username` — Retrieve quotes published by a specific user

#### Social Interactions (`/api/v1/quotes/:id/*`, `/api/v1/users/:username/follow`)
- `POST /api/v1/quotes/:id/like` — Like a quote (atomic counter increment)
- `DELETE /api/v1/quotes/:id/like` — Unlike a quote (atomic decrement)
- `POST /api/v1/quotes/:id/repost` — Repost a quote to followers
- `DELETE /api/v1/quotes/:id/repost` — Remove repost
- `POST /api/v1/quotes/:id/bookmark` — Add quote to private bookmarks
- `DELETE /api/v1/quotes/:id/bookmark` — Remove quote from private bookmarks
- `GET /api/v1/quotes/me/bookmarks` — List private bookmarks with cursor pagination
- `POST /api/v1/users/:username/follow` — Follow a user
- `DELETE /api/v1/users/:username/follow` — Unfollow a user

#### Feeds, Trending & Search
- `GET /api/v1/feed/following` — Reverse-chronological timeline of followed creators
- `GET /api/v1/feed/for-you` — Algorithmic discovery feed (Redis accelerated)
- `GET /api/v1/trending` — Top quotes in the last 24 hours ranked by engagement
- `GET /api/v1/search?q={query}` — PostgreSQL `pg_trgm` fuzzy text search across quotes and usernames

#### Notifications (`/api/v1/notifications`)
- `GET /api/v1/notifications` — List in-app notifications
- `GET /api/v1/notifications/unread-count` — Get count of unread notifications
- `PATCH /api/v1/notifications/:id/read` — Mark notification as read
- `POST /api/v1/notifications/read-all` — Mark all notifications as read

#### Administration (`/api/v1/admin`)
- `GET /api/v1/admin/users` — Paginated user directory with filter by status
- `POST /api/v1/admin/users/:id/suspend` — Suspend user account with reason & duration
- `POST /api/v1/admin/users/:id/unsuspend` — Reactivate suspended user
- `DELETE /api/v1/admin/users/:id` — Administrative user deletion
- `DELETE /api/v1/admin/quotes/:id` — Administrative quote take-down
- `GET /api/v1/admin/audit-logs` — Query immutable audit trail
- `GET /api/v1/admin/metrics` — View platform metrics (signups, quotes, interactions)
- `POST /api/v1/admin/reconcile-counters` — Trigger database counter reconciliation

---

### RFC 9457 Problem Details

All error responses strictly adhere to the **RFC 9457 Problem Details** specification (`application/problem+json`).

**Validation Error Example (HTTP 400 Bad Request):**
```json
{
  "type": "https://quote-hub.local/errors/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "Original quotes must not specify an author name",
  "code": "VALIDATION_ERROR",
  "instance": "/api/v1/quotes",
  "errors": {
    "authorName": [
      "Original quotes must not specify an author name"
    ]
  }
}
```

**Conflict Error Example (HTTP 409 Conflict):**
```json
{
  "type": "https://quote-hub.local/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "You have already liked this quote",
  "code": "ALREADY_LIKED",
  "instance": "/api/v1/quotes/018f3a2c-2000-7000-8000-000000000001/like"
}
```

---

### Idempotent Mutations

Critical mutation endpoints (such as `POST /api/v1/quotes`) accept an `Idempotency-Key` header:

```http
POST /api/v1/quotes HTTP/1.1
Host: localhost:4000
Authorization: Bearer <session-token>
Idempotency-Key: 7f8c9b2a-431e-4284-82a1-fae7dc112233
Content-Type: application/json

{
  "text": "Simplicity is prerequisite for reliability.",
  "isOriginal": false,
  "authorName": "Edsger W. Dijkstra",
  "themeId": "018f3a2c-0000-7000-8000-000000000001"
}
```

- **Replay Detection**: If a request with the same `Idempotency-Key` is received within 24 hours, the server replays the original cached response with header `X-Cache-Idempotent: HIT`.
- **Payload Integrity**: If the same key is reused with a different request payload, the server returns an RFC 9457 `409 Conflict` (`IDEMPOTENCY_MISMATCH`).
- **Concurrent In-Flight Requests**: If an identical key is submitted while the initial transaction is still executing, the server responds with `409 Conflict` (`IDEMPOTENCY_KEY_IN_PROGRESS`).

---

## Observability & Security

- **OpenTelemetry Distributed Tracing**: Auto-instruments Express HTTP routes, database queries via `@prisma/instrumentation`, and exports traces to any standard OTLP endpoint via `@opentelemetry/exporter-trace-otlp-http`.
- **Structured JSON Logging**: Powered by **Pino** with request correlation ID tracking (using UUIDv7 headers `x-request-id`) and pretty printing during local development.
- **Sentry Integration**: Automatic capture of uncaught exceptions, unhandled rejections, and HTTP 500 responses with full stack traces and request metadata.
- **Security Hardening**:
  - **Helmet**: Configures secure HTTP response headers (HSTS, Content Security Policy, X-Content-Type-Options, etc.).
  - **CORS**: Enforces strict origin matching against configured `FRONTEND_ORIGIN`.
  - **Rate Limiting**: Sliding window token bucket rate limiting on authentication routes (`/api/auth/*`) and sensitive mutation endpoints.

---

## Testing & Quality Assurance

Quote-Hub API comes with an extensive automated test suite covering unit functionality, database integration, and end-to-end user journeys:

```bash
# Run all test suites
npm test

# Run tests in watch mode
npx vitest

# Run only unit tests
npx vitest run tests/unit

# Run only integration tests
npx vitest run tests/integration

# Run specific domain journey tests
npx vitest run tests/integration/journeys/social-journey.test.ts
```

### Test Suite Structure
- **Unit Tests (`tests/unit/`)**: Fast, memory-isolated tests for domain services, Zod schemas, utility functions, and background worker logic. Uses `ioredis-mock` for Redis simulation.
- **Integration Tests (`tests/integration/`)**: Supertest-driven API route tests verifying HTTP status codes, headers, middleware execution, and database state transitions.
- **Journey Tests (`tests/integration/journeys/`)**: Realistic multi-step scenarios:
  - `publishing-journey.test.ts`: Creating, editing, theme switching, idempotency replaying, and deleting quotes.
  - `social-journey.test.ts`: Following creators, liking, reposting, bookmarking, and verifying counter consistency.
  - `discovery-journey.test.ts`: Following feeds, trending calculation, and fuzzy text search queries.
  - `admin-journey.test.ts`: Account suspension, quote take-downs, audit logging, and metric rollups.

---

## Environment Variables Reference

| Variable | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | `enum` | No | `development` | Runtime environment (`development`, `test`, `production`) |
| `PORT` | `number` | No | `4000` | Port for the HTTP Express server |
| `DATABASE_URL` | `string` | **Yes** | — | PostgreSQL connection string with credentials |
| `REDIS_URL` | `string` | **Yes** | — | Redis connection URL for caching and BullMQ queues |
| `FRONTEND_ORIGIN` | `string` | **Yes** | — | Allowed origin URL for CORS policy |
| `BETTER_AUTH_SECRET` | `string` | **Yes** | — | Cryptographic secret for signing sessions and tokens |
| `BETTER_AUTH_URL` | `string` | **Yes** | — | Canonical base URL of the Better Auth service |
| `GOOGLE_CLIENT_ID` | `string` | No | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | `string` | No | — | Google OAuth client secret |
| `R2_ACCOUNT_ID` | `string` | No | — | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | `string` | No | — | Cloudflare R2 / S3 access key ID |
| `R2_SECRET_ACCESS_KEY` | `string` | No | — | Cloudflare R2 / S3 secret access key |
| `R2_BUCKET_NAME` | `string` | No | — | S3 bucket name for avatars |
| `R2_PUBLIC_URL` | `string` | No | — | Public CDN URL for serving processed media assets |
| `SENTRY_DSN` | `string` | No | — | Sentry DSN for exception capturing and telemetry |
| `RESEND_API_KEY` | `string` | No | — | Resend API key for transactional emails |
| `EMAIL_FROM` | `string` | No | `Quote-Hub <noreply@...>` | Outgoing sender email address |

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
