import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";

describe("Admin Routes Integration", () => {
  const app = createApp();

  const mockAdminUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-admin-123",
    username: "adminuser",
    displayName: "Admin User",
    bio: "Platform Administrator",
    profileImageUrl: null,
    role: "ADMIN" as const,
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

  const mockAdminSession = {
    session: {
      id: "session-admin-123",
      userId: "auth-admin-123",
      token: "mock-admin-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-admin-123",
      email: "admin@example.com",
      name: "Admin User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockRegularUser = {
    id: "01925b6a-9321-789a-b456-123456789def",
    authId: "auth-user-456",
    username: "regularuser",
    displayName: "Regular User",
    bio: "Standard User",
    profileImageUrl: null,
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

  const mockRegularSession = {
    session: {
      id: "session-user-456",
      userId: "auth-user-456",
      token: "mock-user-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-user-456",
      email: "regular@example.com",
      name: "Regular User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockQuote = {
    id: "01925b6a-1111-7000-8000-000000000001",
    userId: mockRegularUser.id,
    text: "Simplicity is prerequisite for reliability.",
    isOriginal: true,
    authorName: null,
    themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    likeCount: 5,
    repostCount: 2,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const mockDailyMetric = {
    metricDate: new Date("2026-01-01T00:00:00.000Z"),
    registeredUsers: 100,
    activeUsers: 45,
    quotesCreated: 20,
    likesCreated: 80,
    repostsCreated: 15,
    bookmarksCreated: 10,
    followsCreated: 12,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  const mockAuditLog = {
    id: "01925b6a-2222-7000-8000-000000000002",
    actorUserId: mockAdminUser.id,
    action: "ADMIN_DELETED_QUOTE",
    resourceType: "QUOTE",
    resourceId: mockQuote.id,
    metadata: { reason: "Terms of Service violation" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    actorUser: {
      id: mockAdminUser.id,
      username: mockAdminUser.username,
      displayName: mockAdminUser.displayName,
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Unauthenticated Access (401)", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(null as any);
    });

    it("GET /api/v1/admin/users should return 401", async () => {
      const res = await request(app).get("/api/v1/admin/users");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("GET /api/v1/admin/users/:userId should return 401", async () => {
      const res = await request(app).get(`/api/v1/admin/users/${mockRegularUser.id}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("PATCH /api/v1/admin/users/:userId/status should return 401", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/users/${mockRegularUser.id}/status`)
        .send({ status: "SUSPENDED", reason: "Spam" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("GET /api/v1/admin/quotes should return 401", async () => {
      const res = await request(app).get("/api/v1/admin/quotes");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("DELETE /api/v1/admin/quotes/:quoteId should return 401", async () => {
      const res = await request(app).delete(`/api/v1/admin/quotes/${mockQuote.id}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("GET /api/v1/admin/analytics should return 401", async () => {
      const res = await request(app).get("/api/v1/admin/analytics");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("GET /api/v1/admin/audit-logs should return 401", async () => {
      const res = await request(app).get("/api/v1/admin/audit-logs");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("POST /api/v1/admin/reconcile-counters should return 401", async () => {
      const res = await request(app).post("/api/v1/admin/reconcile-counters");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("Non-Admin Access (403)", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(mockRegularSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(mockRegularUser as any);
    });

    it("GET /api/v1/admin/users with USER role should return 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).get("/api/v1/admin/users");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("GET /api/v1/admin/quotes with USER role should return 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).get("/api/v1/admin/quotes");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("DELETE /api/v1/admin/quotes/:quoteId with USER role should return 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).delete(`/api/v1/admin/quotes/${mockQuote.id}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("GET /api/v1/admin/analytics with USER role should return 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).get("/api/v1/admin/analytics");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("GET /api/v1/admin/audit-logs with USER role should return 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).get("/api/v1/admin/audit-logs");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("POST /api/v1/admin/reconcile-counters with USER role should return 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).post("/api/v1/admin/reconcile-counters");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });
  });

  describe("Suspended Admin Access (403)", () => {
    it("should return 403 ACCOUNT_SUSPENDED when admin user is suspended", async () => {
      const suspendedAdmin = {
        ...mockAdminUser,
        status: "SUSPENDED" as const,
        suspendedAt: new Date(),
        suspensionReason: "Under review",
      };
      vi.spyOn(auth.api, "getSession").mockResolvedValue(mockAdminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(suspendedAdmin as any);

      const res = await request(app).get("/api/v1/admin/users");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
    });
  });

  describe("Admin Users Endpoints", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(mockAdminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(mockAdminUser as any);
    });

    it("GET /api/v1/admin/users should return 200 with paginated user list", async () => {
      vi.spyOn(prisma.user, "findMany").mockResolvedValueOnce([mockRegularUser] as any);
      vi.spyOn(prisma.user, "count").mockResolvedValueOnce(1);

      const res = await request(app).get("/api/v1/admin/users?status=ACTIVE&limit=10");
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(1);
      expect(res.body.users[0].id).toBe(mockRegularUser.id);
      expect(res.body.total).toBe(1);
    });

    it("GET /api/v1/admin/users/:userId should return 200 with user profile", async () => {
      vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce(mockRegularUser as any);

      const res = await request(app).get(`/api/v1/admin/users/${mockRegularUser.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(mockRegularUser.id);
      expect(res.body.username).toBe(mockRegularUser.username);
    });

    it("GET /api/v1/admin/users/:userId should return 404 when user is not found", async () => {
      vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce(null);

      const res = await request(app).get("/api/v1/admin/users/01925b6a-9999-7000-8000-000000000099");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("GET /api/v1/admin/users/:userId should return 400 ValidationError for non-UUID userId", async () => {
      const res = await request(app).get("/api/v1/admin/users/non-existent-user");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("PATCH /api/v1/admin/users/:userId/status should suspend user and record audit log", async () => {
      const mockTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue(mockRegularUser),
          update: vi.fn().mockResolvedValue({
            ...mockRegularUser,
            status: "SUSPENDED",
            suspensionReason: "Policy violation",
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

      const res = await request(app)
        .patch(`/api/v1/admin/users/${mockRegularUser.id}/status`)
        .send({
          status: "SUSPENDED",
          reason: "Policy violation",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUSPENDED");
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: mockAdminUser.id,
            action: "ADMIN_SUSPENDED_USER",
            resourceType: "USER",
            resourceId: mockRegularUser.id,
          }),
        })
      );
    });

    it("PATCH /api/v1/admin/users/:userId/status should clear deletedAt when reactivating a deleted user", async () => {
      const mockDeletedUser = {
        ...mockRegularUser,
        status: "DELETED" as const,
        deletedAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      const mockTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue(mockDeletedUser),
          update: vi.fn().mockResolvedValue({
            ...mockDeletedUser,
            status: "ACTIVE",
            deletedAt: null,
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-reactivated" }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

      const res = await request(app)
        .patch(`/api/v1/admin/users/${mockRegularUser.id}/status`)
        .send({
          status: "ACTIVE",
          reason: "Account reactivated after review",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ACTIVE");
      expect(mockTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockRegularUser.id },
          data: expect.objectContaining({
            status: "ACTIVE",
            deletedAt: null,
          }),
        })
      );
    });

    it("PATCH /api/v1/admin/users/:userId/status should reject self-suspension with 400 ValidationError", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/users/${mockAdminUser.id}/status`)
        .send({
          status: "SUSPENDED",
          reason: "Self suspension attempt",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.detail).toBe("Administrators cannot suspend or delete their own account");
    });

    it("PATCH /api/v1/admin/users/:userId/status should reject self-deletion with 400 ValidationError", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/users/${mockAdminUser.id}/status`)
        .send({
          status: "DELETED",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.detail).toBe("Administrators cannot suspend or delete their own account");
    });

    it("PATCH /api/v1/admin/users/:userId/status should reject invalid until date with 400 ValidationError", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/users/${mockRegularUser.id}/status`)
        .send({
          status: "SUSPENDED",
          reason: "Misconduct",
          until: "invalid-date",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("PATCH /api/v1/admin/users/:userId/status should return 400 ValidationError for non-UUID userId", async () => {
      const res = await request(app)
        .patch("/api/v1/admin/users/non-existent-user/status")
        .send({
          status: "ACTIVE",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Admin Quote Moderation Endpoints", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(mockAdminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(mockAdminUser as any);
    });

    it("GET /api/v1/admin/quotes should return 200 with quotes list", async () => {
      vi.spyOn(prisma.quote, "findMany").mockResolvedValueOnce([mockQuote] as any);
      vi.spyOn(prisma.quote, "count").mockResolvedValueOnce(1);

      const res = await request(app).get("/api/v1/admin/quotes?limit=10&offset=0");
      expect(res.status).toBe(200);
      expect(res.body.quotes).toHaveLength(1);
      expect(res.body.quotes[0].id).toBe(mockQuote.id);
      expect(res.body.total).toBe(1);
    });

    it("DELETE /api/v1/admin/quotes/:quoteId should soft-delete quote and record audit log, returning 204", async () => {
      const mockTx = {
        quote: {
          findUnique: vi.fn().mockResolvedValue(mockQuote),
          update: vi.fn().mockResolvedValue({
            ...mockQuote,
            deletedAt: new Date(),
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-log-1" }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

      const res = await request(app)
        .delete(`/api/v1/admin/quotes/${mockQuote.id}`)
        .send({ reason: "Hate speech violation" });

      expect(res.status).toBe(204);
      expect(mockTx.quote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockQuote.id },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
          }),
        })
      );
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: mockAdminUser.id,
            action: "ADMIN_DELETED_QUOTE",
            resourceType: "QUOTE",
            resourceId: mockQuote.id,
            metadata: { reason: "Hate speech violation" },
          }),
        })
      );
    });

    it("DELETE /api/v1/admin/quotes/:quoteId should return 404 when quote does not exist", async () => {
      const mockTx = {
        quote: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

      const res = await request(app).delete("/api/v1/admin/quotes/01925b6a-9999-7000-8000-000000000088");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("DELETE /api/v1/admin/quotes/:quoteId should return 400 ValidationError for non-UUID quoteId", async () => {
      const res = await request(app).delete("/api/v1/admin/quotes/non-existent-quote");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("DELETE /api/v1/admin/quotes/:quoteId should return 404 when quote is already soft-deleted", async () => {
      const mockTx = {
        quote: {
          findUnique: vi.fn().mockResolvedValue({
            ...mockQuote,
            deletedAt: new Date(),
          }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

      const res = await request(app).delete(`/api/v1/admin/quotes/${mockQuote.id}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });
  });

  describe("Admin Analytics Endpoint", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(mockAdminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(mockAdminUser as any);
    });

    it("GET /api/v1/admin/analytics should retrieve metrics from prisma.dailyMetric and return 200", async () => {
      vi.spyOn(prisma.dailyMetric, "findMany").mockResolvedValueOnce([mockDailyMetric] as any);
      vi.spyOn(prisma.dailyMetric, "count").mockResolvedValueOnce(1);

      const res = await request(app).get("/api/v1/admin/analytics?startDate=2026-01-01&endDate=2026-01-02");

      expect(res.status).toBe(200);
      expect(res.body.metrics).toHaveLength(1);
      expect(res.body.metrics[0].registeredUsers).toBe(100);
      expect(res.body.metrics[0].activeUsers).toBe(45);
      expect(res.body.total).toBe(1);

      expect(prisma.dailyMetric.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            metricDate: {
              gte: expect.any(Date),
              lte: expect.any(Date),
            },
          },
          orderBy: { metricDate: "desc" },
        })
      );
    });

    it("GET /api/v1/admin/analytics should return 400 ValidationError when startDate is malformed", async () => {
      const res = await request(app).get("/api/v1/admin/analytics?startDate=invalid");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("GET /api/v1/admin/analytics should return 400 ValidationError when endDate is malformed", async () => {
      const res = await request(app).get("/api/v1/admin/analytics?endDate=invalid");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Admin Audit Logs Endpoint", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(mockAdminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(mockAdminUser as any);
    });

    it("GET /api/v1/admin/audit-logs should return paginated audit logs with actor information", async () => {
      vi.spyOn(prisma.auditLog, "findMany").mockResolvedValueOnce([mockAuditLog] as any);
      vi.spyOn(prisma.auditLog, "count").mockResolvedValueOnce(1);

      const res = await request(app).get("/api/v1/admin/audit-logs?resourceType=QUOTE");

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
      expect(res.body.logs[0].action).toBe("ADMIN_DELETED_QUOTE");
      expect(res.body.logs[0].actorUser.username).toBe(mockAdminUser.username);
      expect(res.body.total).toBe(1);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resourceType: "QUOTE",
          }),
        })
      );
    });
  });

  describe("Counter Reconciliation Endpoint", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(mockAdminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(mockAdminUser as any);
    });

    it("POST /api/v1/admin/reconcile-counters should execute stored procedure and log audit entry", async () => {
      vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({ id: "audit-reconcile-1" } as any);

      const res = await request(app).post("/api/v1/admin/reconcile-counters");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Counters reconciled successfully");

      // Verify stored procedure invocation via tagged template
      expect(prisma.$executeRaw).toHaveBeenCalled();
      // Verify audit log creation
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: mockAdminUser.id,
            action: "ADMIN_RECONCILED_COUNTERS",
            resourceType: "SYSTEM",
            resourceId: "COUNTERS",
          }),
        })
      );
    });
  });
});
