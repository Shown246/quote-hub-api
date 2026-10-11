import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../../src/app/app";
import { auth } from "../../../src/modules/auth/auth";
import { prisma } from "../../../src/infrastructure/database/prisma";

describe("E2E Journey 4: Administration & Moderation Lifecycle", () => {
  const app = createApp();

  const adminUser = {
    id: "01925b6a-9321-789a-b456-0000000000a1",
    authId: "auth-admin-123",
    username: "system_admin",
    displayName: "System Administrator",
    bio: "Platform Moderator",
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

  const adminSession = {
    session: {
      id: "session-admin-123",
      userId: "auth-admin-123",
      token: "admin-mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-admin-123",
      email: "admin@example.com",
      name: "System Administrator",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const violatorUser = {
    id: "01925b6a-9321-789a-b456-0000000000b1",
    authId: "auth-violator-456",
    username: "spammer_user",
    displayName: "Spammer User",
    bio: "Spam account violating rules",
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

  const violatorSession = {
    session: {
      id: "session-violator-456",
      userId: "auth-violator-456",
      token: "violator-mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-violator-456",
      email: "violator@example.com",
      name: "Spammer User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const violatorQuote = {
    id: "01925b6a-9321-789a-b456-0000000000c1",
    userId: violatorUser.id,
    text: "Spam content violating terms of service",
    isOriginal: true,
    authorName: null,
    themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    likeCount: 0,
    repostCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
  });

  describe("1. Non-Admin Authorization Guard", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(violatorSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(violatorUser as any);
    });

    it("should reject standard user access to GET /api/v1/admin/users with 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).get("/api/v1/admin/users");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("should reject standard user access to GET /api/v1/admin/quotes with 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).get("/api/v1/admin/quotes");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("should reject standard user access to DELETE /api/v1/admin/quotes/:quoteId with 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).delete(`/api/v1/admin/quotes/${violatorQuote.id}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("should reject standard user access to GET /api/v1/admin/analytics with 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).get("/api/v1/admin/analytics");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("should reject standard user access to GET /api/v1/admin/audit-logs with 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).get("/api/v1/admin/audit-logs");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });

    it("should reject standard user access to POST /api/v1/admin/reconciliation/counters with 403 ADMIN_ACCESS_REQUIRED", async () => {
      const res = await request(app).post("/api/v1/admin/reconciliation/counters");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    });
  });

  describe("2. Admin User Suspension & Audit Log Verification", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(adminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(adminUser as any);
    });

    it("should allow admin to suspend user and record audit log via PATCH /api/v1/admin/users/:userId/status", async () => {
      vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce(violatorUser as any);

      const suspendedUser = {
        ...violatorUser,
        status: "SUSPENDED" as const,
        suspendedAt: new Date("2026-10-08T12:00:00.000Z"),
        suspensionReason: "Repeated spam violations",
      };
      vi.spyOn(prisma.user, "update").mockResolvedValueOnce(suspendedUser as any);
      vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-0000000000d1",
        actorUserId: adminUser.id,
        action: "ADMIN_SUSPENDED_USER",
        resourceType: "USER",
        resourceId: violatorUser.id,
        metadata: { reason: "Repeated spam violations" },
        createdAt: new Date("2026-10-08T12:00:00.000Z"),
      } as any);

      const res = await request(app)
        .patch(`/api/v1/admin/users/${violatorUser.id}/status`)
        .send({
          status: "SUSPENDED",
          reason: "Repeated spam violations",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUSPENDED");
      expect(res.body.suspensionReason).toBe("Repeated spam violations");
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: adminUser.id,
            action: "ADMIN_SUSPENDED_USER",
            resourceType: "USER",
            resourceId: violatorUser.id,
          }),
        })
      );
    });

    it("should allow admin to inspect suspension audit logs via GET /api/v1/admin/audit-logs", async () => {
      const mockAuditLog = {
        id: "01925b6a-9321-789a-b456-0000000000d1",
        actorUserId: adminUser.id,
        action: "ADMIN_SUSPENDED_USER",
        resourceType: "USER",
        resourceId: violatorUser.id,
        metadata: { reason: "Repeated spam violations" },
        createdAt: new Date("2026-10-08T12:00:00.000Z"),
        actorUser: {
          id: adminUser.id,
          username: adminUser.username,
          displayName: adminUser.displayName,
        },
      };

      vi.spyOn(prisma.auditLog, "findMany").mockResolvedValueOnce([mockAuditLog] as any);
      vi.spyOn(prisma.auditLog, "count").mockResolvedValueOnce(1);

      const res = await request(app).get("/api/v1/admin/audit-logs?resourceType=USER");

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
      expect(res.body.logs[0].action).toBe("ADMIN_SUSPENDED_USER");
      expect(res.body.logs[0].resourceId).toBe(violatorUser.id);
      expect(res.body.total).toBe(1);
    });
  });

  describe("3. Suspended User Posting Block", () => {
    it("should reject quote creation from suspended user with 403 ACCOUNT_SUSPENDED", async () => {
      const suspendedViolator = {
        ...violatorUser,
        status: "SUSPENDED" as const,
        suspendedAt: new Date(),
        suspensionReason: "Repeated spam violations",
      };

      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(violatorSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(suspendedViolator as any);

      const res = await request(app).post("/api/v1/quotes").send({
        text: "Blocked spam quote",
        isOriginal: true,
        themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
      expect(res.body.detail).toBe("Account suspended");
    });
  });

  describe("4. Admin Quote Moderation & Audit Trail", () => {
    beforeEach(() => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(adminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(adminUser as any);
    });

    it("should allow admin to soft-delete offending quote and record audit log via DELETE /api/v1/admin/quotes/:quoteId", async () => {
      vi.spyOn(prisma.quote, "findUnique").mockResolvedValueOnce(violatorQuote as any);
      vi.spyOn(prisma.quote, "update").mockResolvedValueOnce({
        ...violatorQuote,
        deletedAt: new Date("2026-10-08T12:30:00.000Z"),
      } as any);
      vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-0000000000d2",
        actorUserId: adminUser.id,
        action: "ADMIN_DELETED_QUOTE",
        resourceType: "QUOTE",
        resourceId: violatorQuote.id,
        metadata: { reason: "Terms of Service violation" },
        createdAt: new Date("2026-10-08T12:30:00.000Z"),
      } as any);

      const res = await request(app)
        .delete(`/api/v1/admin/quotes/${violatorQuote.id}`)
        .send({ reason: "Terms of Service violation" });

      expect(res.status).toBe(204);
      expect(prisma.quote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: violatorQuote.id },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
          }),
        })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: adminUser.id,
            action: "ADMIN_DELETED_QUOTE",
            resourceType: "QUOTE",
            resourceId: violatorQuote.id,
          }),
        })
      );
    });
  });

  describe("5. Admin Analytics Aggregation", () => {
    it("should allow admin to retrieve daily metrics via GET /api/v1/admin/analytics", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(adminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(adminUser as any);

      const mockDailyMetrics = [
        {
          metricDate: new Date("2026-10-08T00:00:00.000Z"),
          registeredUsers: 150,
          activeUsers: 85,
          quotesCreated: 40,
          likesCreated: 120,
          repostsCreated: 35,
          bookmarksCreated: 25,
          followsCreated: 18,
          createdAt: new Date("2026-10-08T00:00:00.000Z"),
          updatedAt: new Date("2026-10-08T00:00:00.000Z"),
        },
      ];

      vi.spyOn(prisma.dailyMetric, "findMany").mockResolvedValueOnce(mockDailyMetrics as any);
      vi.spyOn(prisma.dailyMetric, "count").mockResolvedValueOnce(1);

      const res = await request(app).get("/api/v1/admin/analytics?limit=30");

      expect(res.status).toBe(200);
      expect(res.body.metrics).toHaveLength(1);
      expect(res.body.metrics[0].registeredUsers).toBe(150);
      expect(res.body.metrics[0].quotesCreated).toBe(40);
      expect(res.body.total).toBe(1);
    });
  });

  describe("6. Admin Maintenance: Counter Reconciliation", () => {
    it("should trigger stored procedure CALL reconcile_all_counters() and record audit log via POST /api/v1/admin/reconciliation/counters", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(adminSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(adminUser as any);
      vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({
        id: "01925b6a-9321-789a-b456-0000000000d3",
        actorUserId: adminUser.id,
        action: "ADMIN_RECONCILED_COUNTERS",
        resourceType: "SYSTEM",
        resourceId: "COUNTERS",
        metadata: { procedure: "reconcile_all_counters" },
        createdAt: new Date(),
      } as any);

      const res = await request(app).post("/api/v1/admin/reconciliation/counters");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Counters reconciled successfully");
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: adminUser.id,
            action: "ADMIN_RECONCILED_COUNTERS",
            resourceType: "SYSTEM",
          }),
        })
      );
    });
  });
});
