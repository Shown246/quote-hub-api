import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";

describe("Quote Routes Integration", () => {
  const app = createApp();

  const mockDomainUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-user-123",
    username: "johndoe",
    displayName: "John Doe",
    bio: "Hello world",
    profileImageUrl: "https://example.com/avatar.webp",
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 42,
    followingCount: 15,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
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
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-user-123",
      email: "john@example.com",
      name: "John Doe",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockTheme = {
    id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    key: "classic-serif",
    name: "Classic Serif",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const mockInactiveTheme = {
    id: "018f972b-5b3a-7d4e-8fa1-0123456789ac",
    key: "inactive-mono",
    name: "Inactive Mono",
    isActive: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const mockQuote = {
    id: "018f972b-5b3a-7d4e-8fa1-012345678901",
    userId: mockDomainUser.id,
    text: "Simplicity is prerequisite for reliability.",
    isOriginal: true,
    authorName: null,
    themeId: mockTheme.id,
    likeCount: 0,
    repostCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Unauthenticated Access (401)", () => {
    it("POST /api/v1/quotes without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Test quote",
        isOriginal: true,
        themeId: mockTheme.id,
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("PATCH /api/v1/quotes/:quoteId without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app)
        .patch(`/api/v1/quotes/${mockQuote.id}`)
        .send({ text: "Updated quote text" });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("DELETE /api/v1/quotes/:quoteId without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).delete(`/api/v1/quotes/${mockQuote.id}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("POST /api/v1/quotes (Creation)", () => {
    it("should return 201 with created quote when authenticated and payload is valid (original quote)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(mockTheme as any);
      vi.spyOn(prisma.quote, "create").mockResolvedValueOnce(mockQuote as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        themeId: mockTheme.id,
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(mockQuote.id);
      expect(res.body.text).toBe("Simplicity is prerequisite for reliability.");
      expect(res.body.userId).toBe(mockDomainUser.id);
      expect(res.body.isOriginal).toBe(true);
      expect(res.body.authorName).toBeNull();
      expect(prisma.quote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: mockDomainUser.id,
            text: "Simplicity is prerequisite for reliability.",
            isOriginal: true,
            authorName: null,
            themeId: mockTheme.id,
          }),
        })
      );
    });

    it("should return 201 with created quote when isOriginal is false and authorName is provided", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(mockTheme as any);

      const curatedQuote = {
        ...mockQuote,
        isOriginal: false,
        authorName: "Edsger W. Dijkstra",
      };
      vi.spyOn(prisma.quote, "create").mockResolvedValueOnce(curatedQuote as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: false,
        authorName: "Edsger W. Dijkstra",
        themeId: mockTheme.id,
      });

      expect(res.status).toBe(201);
      expect(res.body.isOriginal).toBe(false);
      expect(res.body.authorName).toBe("Edsger W. Dijkstra");
    });

    it("should return 400 validation error when text exceeds 280 characters", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/quotes")
        .send({
          text: "a".repeat(281),
          isOriginal: true,
          themeId: mockTheme.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.text).toContain("Quote text must not exceed 280 characters");
    });

    it("should return 400 validation error when text is empty or only whitespace", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "   \n\t   ",
        isOriginal: true,
        themeId: mockTheme.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.text).toContain("Quote text must not be empty");
    });

    it("should return 400 validation error on attribution invariant violation (isOriginal: true with authorName)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "My original thought",
        isOriginal: true,
        authorName: "Someone Else",
        themeId: mockTheme.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.authorName).toContain(
        "Original quotes must not specify an author name"
      );
    });

    it("should return 400 validation error when themeId is not a valid UUID", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Valid quote text",
        isOriginal: true,
        themeId: "not-a-valid-uuid",
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.themeId).toBeDefined();
    });

    it("should return 400 validation error when extraneous properties are provided (strict schema)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Valid quote text",
        isOriginal: true,
        themeId: mockTheme.id,
        extraProp: "disallowed",
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("should return 404 when target theme is not found", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(null);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Valid quote text",
        isOriginal: true,
        themeId: mockTheme.id,
      });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Theme not found");
    });

    it("should return 400 validation error when target theme is inactive", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(mockInactiveTheme as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Valid quote text",
        isOriginal: true,
        themeId: mockInactiveTheme.id,
      });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.detail).toBe("Theme is inactive");
    });

    it("should support idempotency caching on POST /api/v1/quotes with Idempotency-Key", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(mockDomainUser as any);

      // Replay test: existing completed idempotency record
      vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce({
        id: "idemp-rec-1",
        userId: mockDomainUser.id,
        key: "idem-key-123",
        endpoint: "POST /api/v1/quotes",
        requestHash: "e5015b3e64fcaef104f64f4340a5996fbfbc298ff2a02b66d482cc29c4fa20fe", // will be checked or mocked
        status: "COMPLETED",
        responseStatus: 201,
        responseBody: mockQuote,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      const payload = {
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: true,
        themeId: mockTheme.id,
      };

      // Ensure hash matches the payload by computing it or mocking the hash in DB record
      const { computeRequestHash } = await import("../../src/middleware/idempotency");
      const expectedHash = computeRequestHash(payload);

      vi.spyOn(prisma.idempotencyKey, "findUnique").mockReset();
      vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce({
        id: "idemp-rec-1",
        userId: mockDomainUser.id,
        key: "idem-key-123",
        endpoint: "POST /api/v1/quotes",
        requestHash: expectedHash,
        status: "COMPLETED",
        responseStatus: 201,
        responseBody: mockQuote,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      const res = await request(app)
        .post("/api/v1/quotes")
        .set("Idempotency-Key", "idem-key-123")
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.headers["x-cache-idempotent"]).toBe("HIT");
      expect(res.body.id).toBe(mockQuote.id);
    });
  });

  describe("GET /api/v1/quotes/:quoteId", () => {
    it("should return 200 with quote when quote exists and is not soft-deleted", async () => {
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(mockQuote as any);

      const res = await request(app).get(`/api/v1/quotes/${mockQuote.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mockQuote.id);
      expect(res.body.text).toBe(mockQuote.text);
      expect(prisma.quote.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: mockQuote.id,
            deletedAt: null,
          },
        })
      );
    });

    it("should return 404 when quote does not exist", async () => {
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get("/api/v1/quotes/non-existent-id");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Quote not found");
    });

    it("should return 404 when quote is soft-deleted", async () => {
      const softDeletedQuote = {
        ...mockQuote,
        deletedAt: new Date(),
      };
      // findFirst returns null if filtered, or if softDeletedQuote returned with deletedAt !== null:
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(softDeletedQuote as any);

      const res = await request(app).get(`/api/v1/quotes/${mockQuote.id}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Quote not found");
    });
  });

  describe("PATCH /api/v1/quotes/:quoteId (Update)", () => {
    it("should return 200 with updated quote when user is the author", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(mockQuote as any);

      const updatedQuote = {
        ...mockQuote,
        text: "Updated quote text",
      };
      vi.spyOn(prisma.quote, "update").mockResolvedValueOnce(updatedQuote as any);

      const res = await request(app)
        .patch(`/api/v1/quotes/${mockQuote.id}`)
        .send({ text: "Updated quote text" });

      expect(res.status).toBe(200);
      expect(res.body.text).toBe("Updated quote text");
      expect(prisma.quote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockQuote.id },
          data: { text: "Updated quote text", themeId: undefined },
        })
      );
    });

    it("should return 200 when updating both text and themeId as author", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(mockQuote as any);
      vi.spyOn(prisma.theme, "findUnique").mockResolvedValueOnce(mockTheme as any);

      const updatedQuote = {
        ...mockQuote,
        text: "Updated text",
        themeId: mockTheme.id,
      };
      vi.spyOn(prisma.quote, "update").mockResolvedValueOnce(updatedQuote as any);

      const res = await request(app)
        .patch(`/api/v1/quotes/${mockQuote.id}`)
        .send({ text: "Updated text", themeId: mockTheme.id });

      expect(res.status).toBe(200);
      expect(res.body.text).toBe("Updated text");
    });

    it("should return 403 when user is not the author", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const otherUserQuote = {
        ...mockQuote,
        userId: "different-user-id-999",
      };
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(otherUserQuote as any);

      const res = await request(app)
        .patch(`/api/v1/quotes/${mockQuote.id}`)
        .send({ text: "Malicious update" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });

    it("should return 404 when updating non-existent quote", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app)
        .patch("/api/v1/quotes/non-existent")
        .send({ text: "Updated text" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 400 validation error when update text exceeds 280 characters", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .patch(`/api/v1/quotes/${mockQuote.id}`)
        .send({ text: "x".repeat(281) });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 validation error when disallowed fields are provided (e.g. isOriginal or userId)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .patch(`/api/v1/quotes/${mockQuote.id}`)
        .send({ isOriginal: false });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("DELETE /api/v1/quotes/:quoteId (Soft Deletion)", () => {
    it("should return 204 No Content and soft-delete quote when user is the author", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(mockQuote as any);
      vi.spyOn(prisma.quote, "update").mockResolvedValueOnce({
        ...mockQuote,
        deletedAt: new Date(),
      } as any);

      const res = await request(app).delete(`/api/v1/quotes/${mockQuote.id}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(prisma.quote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockQuote.id },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
          }),
        })
      );
    });

    it("should return 403 when user is not the author", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const otherUserQuote = {
        ...mockQuote,
        userId: "different-user-id-999",
      };
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(otherUserQuote as any);

      const res = await request(app).delete(`/api/v1/quotes/${mockQuote.id}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    });

    it("should return 404 when deleting a non-existent quote", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).delete("/api/v1/quotes/non-existent");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });
  });
});
