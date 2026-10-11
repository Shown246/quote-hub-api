import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";

describe("Bookmark Routes Integration", () => {
  const app = createApp();

  const mockDomainUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-user-123",
    username: "bookmarker_user",
    displayName: "Bookmarker User",
    bio: "I bookmark quotes",
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
      email: "bookmarker@example.com",
      name: "Bookmarker User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const quoteId = "01925b6a-9321-789a-b456-quote0000000";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Unauthenticated Access (401)", () => {
    it("POST /api/v1/quotes/:quoteId/bookmark without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/bookmark`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("DELETE /api/v1/quotes/:quoteId/bookmark without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/bookmark`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("GET /api/v1/users/me/bookmarks without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).get("/api/v1/users/me/bookmarks");

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("POST /api/v1/quotes/:quoteId/bookmark", () => {
    it("should return 404 when target quote does not exist or is soft-deleted", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/bookmark`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Quote not found");
    });

    it("should return 200 with { bookmarked: true, quoteId } on success", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce({ id: quoteId } as any);
      vi.spyOn(prisma.bookmark, "findUnique").mockResolvedValueOnce(null);
      vi.spyOn(prisma.bookmark, "create").mockResolvedValueOnce({
        userId: mockDomainUser.id,
        quoteId,
        createdAt: new Date(),
      } as any);

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/bookmark`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bookmarked: true, quoteId });
      expect(prisma.bookmark.create).toHaveBeenCalledWith({
        data: {
          userId: mockDomainUser.id,
          quoteId,
        },
      });
    });

    it("should idempotently return 200 when quote is already bookmarked", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce({ id: quoteId } as any);
      vi.spyOn(prisma.bookmark, "findUnique").mockResolvedValueOnce({
        userId: mockDomainUser.id,
        quoteId,
        createdAt: new Date(),
      } as any);
      const createSpy = vi.spyOn(prisma.bookmark, "create");

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/bookmark`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bookmarked: true, quoteId });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("should idempotently return 200 on concurrent P2002 race condition", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce({ id: quoteId } as any);
      vi.spyOn(prisma.bookmark, "findUnique").mockResolvedValueOnce(null);
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint violation",
        { code: "P2002", clientVersion: "5.0.0" }
      );
      vi.spyOn(prisma.bookmark, "create").mockRejectedValueOnce(p2002Error);

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/bookmark`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bookmarked: true, quoteId });
    });
  });

  describe("DELETE /api/v1/quotes/:quoteId/bookmark", () => {
    it("should return 200 with { bookmarked: false, quoteId } on successful unbookmark", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.bookmark, "delete").mockResolvedValueOnce({
        userId: mockDomainUser.id,
        quoteId,
      } as any);

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/bookmark`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bookmarked: false, quoteId });
      expect(prisma.bookmark.delete).toHaveBeenCalledWith({
        where: {
          userId_quoteId: {
            userId: mockDomainUser.id,
            quoteId,
          },
        },
      });
    });

    it("should idempotently return 200 when bookmark does not exist (P2025)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      const p2025Error = new Prisma.PrismaClientKnownRequestError(
        "Record to delete does not exist",
        { code: "P2025", clientVersion: "5.0.0" }
      );
      vi.spyOn(prisma.bookmark, "delete").mockRejectedValueOnce(p2025Error);

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/bookmark`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bookmarked: false, quoteId });
    });
  });

  describe("GET /api/v1/users/me/bookmarks", () => {
    it("should route correctly to /me/bookmarks without matching /:username parameter", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      const userProfileSpy = vi.spyOn(prisma.user, "findUnique");
      vi.spyOn(prisma.bookmark, "findMany").mockResolvedValueOnce([]);

      const res = await request(app).get("/api/v1/users/me/bookmarks");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], items: [], nextCursor: null });
      // Verify userController.getProfile was NOT invoked
      expect(userProfileSpy).not.toHaveBeenCalled();
    });

    it("should return bookmarks with cursor pagination", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockItems = [
        {
          userId: mockDomainUser.id,
          quoteId: "quote-1",
          createdAt: new Date("2026-03-02T00:00:00Z"),
          quote: { id: "quote-1", text: "Text 1", deletedAt: null },
        },
        {
          userId: mockDomainUser.id,
          quoteId: "quote-2",
          createdAt: new Date("2026-03-01T00:00:00Z"),
          quote: { id: "quote-2", text: "Text 2", deletedAt: null },
        },
      ];

      vi.spyOn(prisma.bookmark, "findMany").mockResolvedValueOnce(mockItems as any);

      const res = await request(app).get("/api/v1/users/me/bookmarks?limit=1");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].quoteId).toBe("quote-1");
      expect(res.body.nextCursor).toBe("quote-1");
    });
  });
});
