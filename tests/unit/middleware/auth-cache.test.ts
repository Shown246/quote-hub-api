import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response } from "express";
import request from "supertest";
import crypto from "crypto";
import { requireAuth, optionalAuth, invalidateUserSessionCache, extractRawAuthToken, hashToken } from "../../../src/middleware/auth";
import { errorHandler } from "../../../src/middleware/error-handler";
import { auth } from "../../../src/modules/auth/auth";
import { prisma } from "../../../src/infrastructure/database/prisma";
import { redis } from "../../../src/infrastructure/redis/redis";
import { UserService } from "../../../src/modules/users/services/user.service";
import { AdminUserService } from "../../../src/modules/admin/services/admin-user.service";

describe("Auth Critical Path Caching", () => {
  const mockDomainUser: any = {
    id: "018f3a2b-c4d5-7e8f-9a0b-1c2d3e4f5a6b",
    authId: "auth-user-123",
    username: "cacheuser",
    displayName: "Cache User",
    bio: "Bio",
    profileImageUrl: null,
    role: "USER",
    status: "ACTIVE",
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 0,
    followingCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const mockSession: any = {
    session: {
      id: "session-abc",
      userId: "auth-user-123",
      token: "test-token-123",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-user-123",
      email: "cache@example.com",
      name: "Cache User",
      emailVerified: true,
      image: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Token extraction and hashing", () => {
    it("should extract token from Authorization Bearer header", () => {
      const token = extractRawAuthToken({
        headers: { authorization: "Bearer my-secret-token" },
      });
      expect(token).toBe("my-secret-token");
    });

    it("should extract token from cookie header", () => {
      const token = extractRawAuthToken({
        headers: { cookie: "other=1; better-auth.session_token=cookie-secret-token; path=/" },
      });
      expect(token).toBe("cookie-secret-token");
    });

    it("should extract token from __Secure- cookie header and req.cookies", () => {
      const tokenFromHeader = extractRawAuthToken({
        headers: { cookie: "other=1; __Secure-better-auth.session_token=secure-cookie-token; path=/" },
      });
      expect(tokenFromHeader).toBe("secure-cookie-token");

      const tokenFromCookies = extractRawAuthToken({
        cookies: { "__Secure-better-auth.session_token": "secure-cookie-token-2" },
      });
      expect(tokenFromCookies).toBe("secure-cookie-token-2");
    });

    it("should compute SHA-256 hash", () => {
      const hash = hashToken("test-token");
      const expected = crypto.createHash("sha256").update("test-token").digest("hex");
      expect(hash).toBe(expected);
    });
  });

  describe("requireAuth Redis Cache Hit", () => {
    const app = express();
    app.get("/test-auth", requireAuth, (req: Request, res: Response) => {
      res.json({ userId: req.user?.id, sessionId: req.session?.session.id });
    });
    app.use(errorHandler);

    it("should bypass Better Auth and Prisma on cache HIT and refresh session and user set TTL", async () => {
      const token = "hit-token-123";
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const cachedPayload = {
        session: mockSession,
        user: mockDomainUser,
      };

      vi.spyOn(redis, "get").mockResolvedValueOnce(JSON.stringify(cachedPayload));
      const mockPipeline = {
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      const pipelineSpy = vi.spyOn(redis, "pipeline").mockReturnValue(mockPipeline as any);
      const getSessionSpy = vi.spyOn(auth.api, "getSession");
      const findFirstSpy = vi.spyOn(prisma.user, "findFirst");

      const res = await request(app)
        .get("/test-auth")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(mockDomainUser.id);
      expect(res.body.sessionId).toBe(mockSession.session.id);
      expect(redis.get).toHaveBeenCalledWith(`auth:session:${tokenHash}`);
      expect(pipelineSpy).toHaveBeenCalled();
      expect(mockPipeline.expire).toHaveBeenCalledWith(`auth:session:${tokenHash}`, 300);
      expect(mockPipeline.expire).toHaveBeenCalledWith(`auth:user-sessions:${mockDomainUser.id}`, 300);
      expect(mockPipeline.exec).toHaveBeenCalled();
      expect(getSessionSpy).not.toHaveBeenCalled();
      expect(findFirstSpy).not.toHaveBeenCalled();
    });
  });

  describe("requireAuth Redis Cache Miss", () => {
    const app = express();
    app.get("/test-auth", requireAuth, (req: Request, res: Response) => {
      res.json({ userId: req.user?.id, sessionId: req.session?.session.id });
    });
    app.use(errorHandler);

    it("should query Better Auth and Prisma and store in Redis on cache MISS", async () => {
      const token = "miss-token-123";
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      vi.spyOn(redis, "get").mockResolvedValueOnce(null);
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockPipeline = {
        set: vi.fn().mockReturnThis(),
        sadd: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      vi.spyOn(redis, "pipeline").mockReturnValueOnce(mockPipeline as any);

      const res = await request(app)
        .get("/test-auth")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockPipeline.set).toHaveBeenCalledWith(
        `auth:session:${tokenHash}`,
        expect.any(String),
        "EX",
        300
      );
      expect(mockPipeline.sadd).toHaveBeenCalledWith(
        `auth:user-sessions:${mockDomainUser.id}`,
        tokenHash
      );
      expect(mockPipeline.expire).toHaveBeenCalledWith(
        `auth:user-sessions:${mockDomainUser.id}`,
        300
      );
      expect(mockPipeline.exec).toHaveBeenCalledOnce();
    });
  });

  describe("invalidateUserSessionCache", () => {
    it("should delete all linked session hashes and user sessions set", async () => {
      const userId = "user-to-invalidate";
      vi.spyOn(redis, "smembers").mockResolvedValueOnce(["hash1", "hash2"]);

      const mockPipeline = {
        del: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      vi.spyOn(redis, "pipeline").mockReturnValueOnce(mockPipeline as any);

      await invalidateUserSessionCache(userId);

      expect(redis.smembers).toHaveBeenCalledWith(`auth:user-sessions:${userId}`);
      expect(mockPipeline.del).toHaveBeenCalledWith(`auth:session:hash1`);
      expect(mockPipeline.del).toHaveBeenCalledWith(`auth:session:hash2`);
      expect(mockPipeline.del).toHaveBeenCalledWith(`auth:user-sessions:${userId}`);
      expect(mockPipeline.exec).toHaveBeenCalledOnce();
    });
  });
});
