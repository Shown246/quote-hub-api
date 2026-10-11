import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { requireAuth, optionalAuth } from "../../../src/middleware/auth";
import { errorHandler } from "../../../src/middleware/error-handler";
import { auth } from "../../../src/modules/auth/auth";
import { prisma } from "../../../src/infrastructure/database/prisma";

describe("Auth Middleware", () => {
  const mockDomainUser = {
    id: "018f3a2b-c4d5-7e8f-9a0b-1c2d3e4f5a6b",
    authId: "auth-user-123",
    username: "johndoe",
    displayName: "John Doe",
    bio: "Hello world",
    profileImageUrl: "https://example.com/avatar.jpg",
    role: "USER",
    status: "ACTIVE",
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

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("requireAuth", () => {
    const app = express();
    app.get("/protected", requireAuth, (req, res) =>
      res.json({ user: req.user, session: req.session })
    );
    app.use(errorHandler);

    it("should return 401 AuthenticationError when no session is found", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).get("/protected");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
      expect(res.body.title).toBe("Authentication required");
    });

    it("should return 200 and attach user and session when active user is authenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).get("/protected");
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(mockDomainUser.id);
      expect(res.body.user.username).toBe("johndoe");
      expect(res.body.session.session.id).toBe("session-123");
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { authId: "auth-user-123", deletedAt: null },
      });
    });

    it("should return 401 when domain user is not found", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get("/protected");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
      expect(res.body.detail).toBe("User not found");
    });

    it("should return 401 when domain user is soft-deleted (deletedAt is not null)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      // Prisma filter `deletedAt: null` excludes soft-deleted users, returning null
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get("/protected");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should return 403 AuthorizationError when user status is SUSPENDED", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({
        ...mockDomainUser,
        status: "SUSPENDED",
      } as any);

      const res = await request(app).get("/protected");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
      expect(res.body.detail).toBe("Account suspended");
    });

    it("should return 401 when session has no user id", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        session: mockSession.session,
        user: {} as any,
      } as any);

      const res = await request(app).get("/protected");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should return 401 when domain user status is DELETED", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({
        ...mockDomainUser,
        status: "DELETED",
      } as any);

      const res = await request(app).get("/protected");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
      expect(res.body.detail).toBe("User not found");
    });

    it("should propagate unexpected errors to error handler as 500", async () => {
      vi.spyOn(auth.api, "getSession").mockRejectedValueOnce(new Error("Database connection lost"));

      const res = await request(app).get("/protected");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_SERVER_ERROR");
    });
  });

  describe("optionalAuth", () => {
    const app = express();
    app.get("/optional", optionalAuth, (req, res) =>
      res.json({ user: req.user ?? null, session: req.session ?? null })
    );
    app.use(errorHandler);

    it("should attach user and session when active session is present", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).get("/optional");
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(mockDomainUser.id);
      expect(res.body.session.session.id).toBe("session-123");
    });

    it("should continue with undefined user and session when no session is present", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).get("/optional");
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
      expect(res.body.session).toBeNull();
    });

    it("should continue with undefined user and session when session has no user id", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        session: mockSession.session,
        user: {} as any,
      } as any);

      const res = await request(app).get("/optional");
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
      expect(res.body.session).toBeNull();
    });

    it("should continue with undefined user and session when user is suspended", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({
        ...mockDomainUser,
        status: "SUSPENDED",
      } as any);

      const res = await request(app).get("/optional");
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
      expect(res.body.session).toBeNull();
    });

    it("should continue with undefined user and session when user is DELETED", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({
        ...mockDomainUser,
        status: "DELETED",
      } as any);

      const res = await request(app).get("/optional");
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
      expect(res.body.session).toBeNull();
    });

    it("should continue with undefined user and session when user is not found or soft-deleted", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get("/optional");
      expect(res.status).toBe(200);
      expect(res.body.user).toBeNull();
      expect(res.body.session).toBeNull();
    });

    it("should propagate unexpected errors to error handler as 500", async () => {
      vi.spyOn(auth.api, "getSession").mockRejectedValueOnce(new Error("Unexpected failure"));

      const res = await request(app).get("/optional");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_SERVER_ERROR");
    });
  });
});
