import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";

describe("Sensitive Route Rate Limiting Integration", () => {
  const app = createApp();

  const mockUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-user-123",
    username: "testuser",
    displayName: "Test User",
    bio: "Bio",
    profileImageUrl: null,
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 0,
    followingCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockSession = {
    session: {
      id: "session-123",
      userId: "auth-user-123",
      token: "mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: "auth-user-123",
      email: "test@example.com",
      name: "Test User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  beforeEach(() => {
    vi.spyOn(auth.api, "getSession").mockResolvedValue(mockSession as any);
    vi.spyOn(prisma.user, "findFirst").mockResolvedValue(mockUser as any);
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue(mockUser as any);
  });

  afterEach(() => {
    delete process.env.RATE_LIMIT_QUOTES_CREATE_MAX;
    delete process.env.RATE_LIMIT_LIKES_MAX;
    delete process.env.RATE_LIMIT_SEARCH_MAX;
    delete process.env.RATE_LIMIT_ADMIN_MAX;
    delete process.env.RATE_LIMIT_NOTIFICATIONS_MAX;
    vi.restoreAllMocks();
  });

  it("enforces rate limit on POST /api/v1/quotes and returns 429 when exceeded", async () => {
    process.env.RATE_LIMIT_QUOTES_CREATE_MAX = "2";

    vi.spyOn(prisma.theme, "findUnique").mockResolvedValue({
      id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
      isActive: true,
    } as any);
    vi.spyOn(prisma.quote, "create").mockResolvedValue({
      id: "quote-1",
      userId: mockUser.id,
      text: "Test quote",
      isOriginal: true,
      authorName: null,
      themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
      likeCount: 0,
      repostCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as any);

    const payload = {
      text: "A wise quote",
      isOriginal: true,
      themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    };

    // Request 1
    const res1 = await request(app).post("/api/v1/quotes").send(payload);
    expect(res1.status).toBe(201);

    // Request 2
    const res2 = await request(app).post("/api/v1/quotes").send(payload);
    expect(res2.status).toBe(201);

    // Request 3 exceeds limit
    const res3 = await request(app).post("/api/v1/quotes").send(payload);
    expect(res3.status).toBe(429);
    expect(res3.body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(res3.headers["retry-after"]).toBeDefined();
  });

  it("enforces rate limit on POST /api/v1/quotes/:quoteId/like and returns 429 when exceeded", async () => {
    process.env.RATE_LIMIT_LIKES_MAX = "1";

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
    vi.spyOn(prisma.quote, "findFirst").mockResolvedValue({
      id: "quote-target",
      userId: "other-user-id",
      deletedAt: null,
    } as any);
    vi.spyOn(prisma.like, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.like, "create").mockResolvedValue({} as any);
    vi.spyOn(prisma, "$executeRaw").mockResolvedValue(1 as any);
    vi.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

    // Request 1
    const res1 = await request(app).post("/api/v1/quotes/quote-target/like");
    expect(res1.status).toBe(200);

    // Request 2 exceeds limit
    const res2 = await request(app).post("/api/v1/quotes/quote-target/like");
    expect(res2.status).toBe(429);
    expect(res2.body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(res2.headers["retry-after"]).toBeDefined();
  });

  it("enforces rate limit on GET /api/v1/search and returns 429 when exceeded", async () => {
    process.env.RATE_LIMIT_SEARCH_MAX = "1";

    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([]);

    // Request 1
    const res1 = await request(app).get("/api/v1/search?q=wisdom");
    expect(res1.status).toBe(200);

    // Request 2 exceeds limit
    const res2 = await request(app).get("/api/v1/search?q=wisdom");
    expect(res2.status).toBe(429);
    expect(res2.body.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("enforces rate limit on GET /api/v1/admin/users and returns 429 when exceeded", async () => {
    process.env.RATE_LIMIT_ADMIN_MAX = "1";

    vi.spyOn(prisma.user, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.user, "count").mockResolvedValue(0);

    // Request 1
    const res1 = await request(app).get("/api/v1/admin/users");
    expect(res1.status).toBe(200);

    // Request 2 exceeds limit
    const res2 = await request(app).get("/api/v1/admin/users");
    expect(res2.status).toBe(429);
    expect(res2.body.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});
