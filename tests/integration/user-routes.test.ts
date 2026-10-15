import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";

describe("User Routes Integration", () => {
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
    suspendedAt: new Date("2026-01-01T00:00:00.000Z"),
    suspendedUntil: new Date("2026-02-01T00:00:00.000Z"),
    suspensionReason: "Internal note",
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

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/v1/users/:username", () => {
    it("should return 404 when user is not found", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get("/api/v1/users/nonexistent");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Resource not found");
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            username: "nonexistent",
            deletedAt: null,
          }),
        })
      );
    });

    it("should return 200 with sanitized user profile, omitting internal fields", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).get("/api/v1/users/johndoe");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mockDomainUser.id);
      expect(res.body.username).toBe("johndoe");
      expect(res.body.displayName).toBe("John Doe");
      expect(res.body.bio).toBe("Hello world");
      expect(res.body.profileImageUrl).toBe("https://example.com/avatar.webp");
      expect(res.body.role).toBe("USER");
      expect(res.body.status).toBe("ACTIVE");
      expect(res.body.followerCount).toBe(42);
      expect(res.body.followingCount).toBe(15);
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();

      // Ensure internal database fields are sanitized
      expect(res.body.authId).toBeUndefined();
      expect(res.body.suspendedAt).toBeUndefined();
      expect(res.body.suspendedUntil).toBeUndefined();
      expect(res.body.suspensionReason).toBeUndefined();
      expect(res.body.deletedAt).toBeUndefined();
    });
  });
 
  describe("GET /api/v1/users/me", () => {
    it("should return 401 when unauthenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).get("/api/v1/users/me");

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should return 200 with sanitized authenticated user profile", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).get("/api/v1/users/me");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mockDomainUser.id);
      expect(res.body.username).toBe("johndoe");
      expect(res.body.displayName).toBe("John Doe");
      expect(res.body.role).toBe("USER");
      expect(res.body.status).toBe("ACTIVE");
      expect(res.body.authId).toBeUndefined();
      expect(res.body.suspendedAt).toBeUndefined();
    });
  });

  describe("POST /api/v1/users/me/username", () => {
    it("should return 401 when unauthenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app)
        .post("/api/v1/users/me/username")
        .send({ username: "myhandle" });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should return 400 when username format is invalid", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/users/me/username")
        .send({ username: "in" }); // too short

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("should return 409 when username is already taken", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst")
        .mockResolvedValueOnce(mockDomainUser as any) // requireAuth
        .mockResolvedValueOnce({ ...mockDomainUser, id: "other-id", username: "taken" } as any); // findByUsername

      const res = await request(app)
        .post("/api/v1/users/me/username")
        .send({ username: "taken" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");
    });

    it("should return 200 with updated profile when valid", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst")
        .mockResolvedValueOnce(mockDomainUser as any) // requireAuth
        .mockResolvedValueOnce(null); // findByUsername
      vi.spyOn(prisma.user, "update").mockResolvedValueOnce({
        ...mockDomainUser,
        username: "new_valid_handle",
      } as any);

      const res = await request(app)
        .post("/api/v1/users/me/username")
        .send({ username: "new_valid_handle" });

      expect(res.status).toBe(200);
      expect(res.body.username).toBe("new_valid_handle");
    });
  });

  describe("PATCH /api/v1/users/me", () => {
    it("should return 401 when unauthenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app)
        .patch("/api/v1/users/me")
        .send({ displayName: "New Name" });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should return 400 when body contains disallowed extra fields (strict mass-assignment)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .patch("/api/v1/users/me")
        .send({ displayName: "New Name", role: "ADMIN" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors).toBeDefined();
    });

    it("should reject payload when userId forgery is attempted due to strict schema", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .patch("/api/v1/users/me")
        .send({
          displayName: "Updated John",
          userId: "hacked-user-id",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("should strictly ignore body tampering, update user, and return sanitized profile", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst")
        .mockResolvedValueOnce(mockDomainUser as any) // requireAuth
        .mockResolvedValueOnce(mockDomainUser as any); // userService.updateProfile findById

      const updatedUser = {
        ...mockDomainUser,
        displayName: "Updated John",
        bio: "Updated bio",
      };
      const updateSpy = vi
        .spyOn(prisma.user, "update")
        .mockResolvedValueOnce(updatedUser as any);

      const res = await request(app)
        .patch("/api/v1/users/me")
        .send({
          displayName: "Updated John",
          bio: "Updated bio",
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mockDomainUser.id);
      expect(res.body.displayName).toBe("Updated John");
      expect(res.body.bio).toBe("Updated bio");
      // Sanitize internal fields
      expect(res.body.authId).toBeUndefined();
      expect(res.body.suspendedAt).toBeUndefined();
      expect(res.body.suspendedUntil).toBeUndefined();
      expect(res.body.suspensionReason).toBeUndefined();
      expect(res.body.deletedAt).toBeUndefined();

      // Must use authenticated user ID strictly from req.user.id
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockDomainUser.id },
          data: {
            displayName: "Updated John",
            bio: "Updated bio",
          },
        })
      );
    });
  });

  describe("POST /api/v1/users/me/profile-image", () => {
    it("should return 401 when unauthenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app)
        .post("/api/v1/users/me/profile-image")
        .send({ contentType: "image/jpeg" });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should return 400 when body is missing contentType", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/users/me/profile-image")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.contentType).toBeDefined();
    });

    it("should return 400 when contentType is empty string", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/users/me/profile-image")
        .send({ contentType: "" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 when body contains extraneous unexpected fields", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/users/me/profile-image")
        .send({ contentType: "image/png", extraField: "disallowed" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 when contentLength is negative or non-integer", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/users/me/profile-image")
        .send({ contentType: "image/png", contentLength: -100 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors?.contentLength).toBeDefined();
    });

    it("should return 400 when invalid MIME type is provided", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/users/me/profile-image")
        .send({ contentType: "image/gif" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.detail).toContain("Unsupported content type");
    });

    it("should return 400 when contentLength exceeds 5MB limit", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/users/me/profile-image")
        .send({
          contentType: "image/png",
          contentLength: 6 * 1024 * 1024,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.detail).toBe("File size exceeds 5MB limit");
    });

    it("should return 200 with presigned uploadUrl and key when valid image type and length are provided", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .post("/api/v1/users/me/profile-image")
        .send({ contentType: "image/png", contentLength: 1024 * 1024 });

      expect(res.status).toBe(200);
      expect(res.body.uploadUrl).toBeDefined();
      expect(typeof res.body.uploadUrl).toBe("string");
      expect(res.body.key).toMatch(
        new RegExp(`^uploads/avatars/${mockDomainUser.id}/\\d+\\.png$`)
      );
    });
  });

  describe("Better Auth Handler Mounting", () => {
    it("should mount Better Auth handler at /api/auth/*", async () => {
      const res = await request(app).get("/api/auth/get-session");
      // Better Auth handles the request and responds with 200 (null session)
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    it("should mount Better Auth handler at /api/v1/auth/*", async () => {
      const res = await request(app).get("/api/v1/auth/get-session");
      // Handled by Better Auth router (not falling through to Problem Details 404 handler)
      expect([200, 404]).toContain(res.status);
      expect(res.body?.code).toBeUndefined();
    });
  });

  describe("DELETE /api/v1/users/me", () => {
    it("should return 401 when unauthenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).delete("/api/v1/users/me");

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should return 200 and soft-delete user when authenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst")
        .mockResolvedValueOnce(mockDomainUser as any); // requireAuth

      const mockTx = {
        user: {
          findFirst: vi.fn().mockResolvedValue(mockDomainUser),
          update: vi.fn().mockResolvedValue({
            ...mockDomainUser,
            status: "DELETED",
            deletedAt: new Date(),
          }),
        },
        outboxEvent: {
          create: vi.fn().mockResolvedValue({}),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).delete("/api/v1/users/me");

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Account deleted successfully");
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockDomainUser.id },
          data: expect.objectContaining({
            status: "DELETED",
          }),
        })
      );
      expect(mockTx.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "UserDeleted",
            aggregateType: "User",
            aggregateId: mockDomainUser.id,
            payload: { userId: mockDomainUser.id },
          }),
        })
      );
    });
  });
});
