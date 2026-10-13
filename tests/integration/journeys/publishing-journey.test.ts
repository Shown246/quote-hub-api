import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../../src/app/app";
import { auth } from "../../../src/modules/auth/auth";
import { prisma } from "../../../src/infrastructure/database/prisma";
import { computeRequestHash } from "../../../src/middleware/idempotency";
import { invalidateCache } from "../../../src/infrastructure/redis/cache";

describe("E2E Journey 1: Publishing Lifecycle", () => {
  const app = createApp();

  const authorUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-author-123",
    username: "author_user",
    displayName: "Author User",
    bio: "I publish inspiring thoughts",
    profileImageUrl: "https://example.com/avatar.webp",
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 10,
    followingCount: 5,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const authorSession = {
    session: {
      id: "session-author-123",
      userId: "auth-author-123",
      token: "author-mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-author-123",
      email: "author@example.com",
      name: "Author User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const otherUser = {
    id: "01925b6a-9321-789a-b456-999999999999",
    authId: "auth-other-456",
    username: "other_user",
    displayName: "Other User",
    bio: "Unauthorized reader",
    profileImageUrl: null,
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 0,
    followingCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const otherSession = {
    session: {
      id: "session-other-456",
      userId: "auth-other-456",
      token: "other-mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-other-456",
      email: "other@example.com",
      name: "Other User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const validTheme = {
    id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    key: "classic-serif",
    name: "Classic Serif",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const publishedQuote = {
    id: "018f972b-5b3a-7d4e-8fa1-012345678999",
    userId: authorUser.id,
    text: "Simplicity is prerequisite for reliability.",
    isOriginal: true,
    authorName: null,
    themeId: validTheme.id,
    likeCount: 0,
    repostCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await invalidateCache(`cache:quote:${publishedQuote.id}`);
  });

  describe("1. System Health Verification", () => {
    it("should verify API liveness via GET /health/live", async () => {
      const res = await request(app).get("/health/live");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("alive");
      expect(res.body.timestamp).toBeDefined();
    });

    it("should verify database and service readiness via GET /health/ready", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }] as any);

      const res = await request(app).get("/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
      expect(res.body.services?.database).toBe("healthy");
    });
  });

  describe("2. Authentication Guard", () => {
    it("should reject unauthenticated quote creation with 401 AUTHENTICATION_REQUIRED", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "An unauthorized quote",
        isOriginal: true,
        themeId: validTheme.id,
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("3. Input Validation and Attribution Invariants", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(authorSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(authorUser as any);
    });

    it("should enforce the 280-character maximum length limit", async () => {
      const res = await request(app).post("/api/v1/quotes").send({
        text: "X".repeat(281),
        isOriginal: true,
        themeId: validTheme.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.text).toContain("Quote text must not exceed 280 characters");
    });

    it("should reject empty or whitespace-only quote text", async () => {
      const res = await request(app).post("/api/v1/quotes").send({
        text: "    \t\n   ",
        isOriginal: true,
        themeId: validTheme.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.text).toContain("Quote text must not be empty");
    });

    it("should enforce attribution invariant: original quotes must NOT have an author name", async () => {
      const res = await request(app).post("/api/v1/quotes").send({
        text: "My original thought",
        isOriginal: true,
        authorName: "Attributed Author",
        themeId: validTheme.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.authorName).toContain("Original quotes must not specify an author name");
    });

    it("should reject empty authorName when authorName is provided", async () => {
      const res = await request(app).post("/api/v1/quotes").send({
        text: "A famous quote with empty author",
        isOriginal: false,
        authorName: "   ",
        themeId: validTheme.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.authorName).toContain("Author name must not be empty");
    });
  });

  describe("4. Quote Publishing & Idempotency Key Handling", () => {
    it("should successfully publish an original quote and return 201 Created", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(authorSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(authorUser as any);
      vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(validTheme as any);
      vi.spyOn(prisma.quote, "create").mockResolvedValueOnce(publishedQuote as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        themeId: validTheme.id,
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(publishedQuote.id);
      expect(res.body.userId).toBe(authorUser.id);
      expect(res.body.isOriginal).toBe(true);
      expect(res.body.authorName).toBeNull();
      expect(prisma.quote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: authorUser.id,
            text: "Simplicity is prerequisite for reliability.",
            isOriginal: true,
            themeId: validTheme.id,
          }),
        })
      );
    });

    it("should replay cached 201 response when submitted with identical Idempotency-Key", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(authorSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(authorUser as any);

      const payload = {
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        themeId: validTheme.id,
      };

      const requestHash = computeRequestHash(payload);

      vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce({
        id: "idemp-journal-1",
        userId: authorUser.id,
        key: "publish-idem-key-001",
        endpoint: "POST /api/v1/quotes",
        requestHash,
        status: "COMPLETED",
        responseStatus: 201,
        responseBody: publishedQuote,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      const res = await request(app)
        .post("/api/v1/quotes")
        .set("Idempotency-Key", "publish-idem-key-001")
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.headers["x-cache-idempotent"]).toBe("HIT");
      expect(res.body.id).toBe(publishedQuote.id);
      expect(res.body.text).toBe(publishedQuote.text);
    });
  });

  describe("5. Public Retrieval", () => {
    it("should retrieve published quote by ID via GET /api/v1/quotes/:id", async () => {
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(publishedQuote as any);

      const res = await request(app).get(`/api/v1/quotes/${publishedQuote.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(publishedQuote.id);
      expect(res.body.text).toBe(publishedQuote.text);
      expect(prisma.quote.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: publishedQuote.id,
            deletedAt: null,
          },
        })
      );
    });

    it("should return 404 NOT_FOUND when querying a non-existent quote ID", async () => {
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get("/api/v1/quotes/01925b6a-9321-789a-b456-nonexistent00");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });
  });

  describe("6. Author Modification", () => {
    it("should allow the quote author to update text and theme via PATCH /api/v1/quotes/:id", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(authorSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(authorUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(publishedQuote as any);
      vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(validTheme as any);

      const updatedText = "Simplicity is prerequisite for reliability. (Revised)";
      const updatedQuote = {
        ...publishedQuote,
        text: updatedText,
      };
      vi.spyOn(prisma.quote, "update").mockResolvedValueOnce(updatedQuote as any);

      const res = await request(app)
        .patch(`/api/v1/quotes/${publishedQuote.id}`)
        .send({ text: updatedText, themeId: validTheme.id });

      expect(res.status).toBe(200);
      expect(res.body.text).toBe(updatedText);
      expect(prisma.quote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: publishedQuote.id },
          data: { text: updatedText, themeId: validTheme.id },
        })
      );
    });
  });

  describe("7. Unauthorized Modification and Deletion Guards", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(otherSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(otherUser as any);
    });

    it("should reject quote update by unauthorized user with 403 FORBIDDEN", async () => {
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(publishedQuote as any);

      const res = await request(app)
        .patch(`/api/v1/quotes/${publishedQuote.id}`)
        .send({ text: "Malicious tampering" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });

    it("should reject quote deletion by unauthorized user with 403 FORBIDDEN", async () => {
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(publishedQuote as any);

      const res = await request(app).delete(`/api/v1/quotes/${publishedQuote.id}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });
  });

  describe("8. Author Soft Deletion & Post-Deletion 404", () => {
    it("should allow author to soft-delete quote with 204 No Content", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(authorSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(authorUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(publishedQuote as any);
      vi.spyOn(prisma.quote, "update").mockResolvedValueOnce({
        ...publishedQuote,
        deletedAt: new Date(),
      } as any);

      const res = await request(app).delete(`/api/v1/quotes/${publishedQuote.id}`);

      expect(res.status).toBe(204);
      expect(prisma.quote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: publishedQuote.id },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
          }),
        })
      );
    });

    it("should return 404 when querying soft-deleted quote via GET /api/v1/quotes/:id", async () => {
      // After soft deletion, findFirst with where: { deletedAt: null } resolves to null
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get(`/api/v1/quotes/${publishedQuote.id}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Quote not found");
    });
  });
});
