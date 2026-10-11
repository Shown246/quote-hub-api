import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditService, auditService } from "../../../../src/modules/admin/services/audit.service";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import { logger } from "../../../../src/infrastructure/logging/logger";
import { isValidUuidV7 } from "../../../../src/shared/utils/uuidv7";
import { Prisma } from "@prisma/client";

describe("AuditService", () => {
  let service: AuditService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new AuditService();
  });

  describe("recordAction", () => {
    it("recordAction should insert row into audit_logs with generated UUIDv7", async () => {
      const mockCreated = {
        id: "01926b48-1234-7000-8000-000000000001",
        actorUserId: "admin-1",
        action: "ADMIN_SUSPENDED_USER",
        resourceType: "USER",
        resourceId: "user-2",
        metadata: { reason: "Spam" },
        createdAt: new Date(),
      };

      const spy = vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce(mockCreated as any);
      const loggerSpy = vi.spyOn(logger, "info");

      const result = await service.recordAction(
        "admin-1",
        "ADMIN_SUSPENDED_USER",
        "USER",
        "user-2",
        { reason: "Spam" }
      );

      expect(spy).toHaveBeenCalledTimes(1);
      const callArg = spy.mock.calls[0][0];
      expect(callArg.data).toBeDefined();
      expect(callArg.data.actorUserId).toBe("admin-1");
      expect(callArg.data.action).toBe("ADMIN_SUSPENDED_USER");
      expect(callArg.data.resourceType).toBe("USER");
      expect(callArg.data.resourceId).toBe("user-2");
      expect(callArg.data.metadata).toEqual({ reason: "Spam" });
      expect(isValidUuidV7(callArg.data.id)).toBe(true);
      expect(result).toEqual(mockCreated);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "audit.action_recorded",
          actorId: "admin-1",
          action: "ADMIN_SUSPENDED_USER",
          resourceType: "USER",
          resourceId: "user-2",
          metadata: { reason: "Spam" },
        }),
        expect.any(String)
      );
    });

    it("recordAction should respect passed transaction client tx", async () => {
      const mockTx = {
        auditLog: {
          create: vi.fn().mockResolvedValueOnce({
            id: "tx-audit-log-1",
            actorUserId: "admin-2",
            action: "ADMIN_DELETED_QUOTE",
            resourceType: "QUOTE",
            resourceId: "quote-99",
            metadata: null,
            createdAt: new Date(),
          }),
        },
      } as unknown as Prisma.TransactionClient;

      const prismaSpy = vi.spyOn(prisma.auditLog, "create");

      const result = await service.recordAction(
        "admin-2",
        "ADMIN_DELETED_QUOTE",
        "QUOTE",
        "quote-99",
        null,
        mockTx
      );

      expect(prismaSpy).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).toHaveBeenCalledTimes(1);
      const callArg = (mockTx.auditLog.create as any).mock.calls[0][0];
      expect(callArg.data.actorUserId).toBe("admin-2");
      expect(callArg.data.action).toBe("ADMIN_DELETED_QUOTE");
      expect(callArg.data.resourceType).toBe("QUOTE");
      expect(callArg.data.resourceId).toBe("quote-99");
      expect(callArg.data.metadata).toBe(Prisma.DbNull);
      expect(isValidUuidV7(callArg.data.id)).toBe(true);
      expect(result.id).toBe("tx-audit-log-1");
    });

    it("recordAction should handle omitted metadata", async () => {
      const spy = vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({
        id: "audit-3",
        actorUserId: "admin-3",
        action: "ADMIN_UNSUSPENDED_USER",
        resourceType: "USER",
        resourceId: "user-3",
        metadata: null,
        createdAt: new Date(),
      } as any);

      await service.recordAction("admin-3", "ADMIN_UNSUSPENDED_USER", "USER", "user-3");

      expect(spy).toHaveBeenCalledTimes(1);
      const callArg = spy.mock.calls[0][0];
      expect(callArg.data.actorUserId).toBe("admin-3");
      expect(callArg.data.action).toBe("ADMIN_UNSUSPENDED_USER");
      expect(callArg.data.metadata).toBeUndefined();
    });
  });

  describe("listLogs", () => {
    it("listLogs should return paginated audit records with actor information and total count", async () => {
      const mockLogs = [
        {
          id: "log-1",
          actorUserId: "admin-1",
          action: "ADMIN_SUSPENDED_USER",
          resourceType: "USER",
          resourceId: "user-2",
          metadata: { reason: "Spam" },
          createdAt: new Date("2026-10-08T12:00:00Z"),
          actorUser: {
            id: "admin-1",
            username: "adminuser",
            displayName: "Admin User",
          },
        },
      ];

      const findManySpy = vi.spyOn(prisma.auditLog, "findMany").mockResolvedValueOnce(mockLogs as any);
      const countSpy = vi.spyOn(prisma.auditLog, "count").mockResolvedValueOnce(1);

      const result = await service.listLogs({ limit: 10, offset: 0 });

      expect(findManySpy).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: "desc" },
        take: 10,
        skip: 0,
        include: {
          actorUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
        },
      });
      expect(countSpy).toHaveBeenCalledWith({ where: {} });
      expect(result).toEqual({
        logs: mockLogs,
        total: 1,
      });
    });

    it("listLogs should apply filters when actorId, resourceType, and resourceId are provided", async () => {
      const findManySpy = vi.spyOn(prisma.auditLog, "findMany").mockResolvedValueOnce([]);
      const countSpy = vi.spyOn(prisma.auditLog, "count").mockResolvedValueOnce(0);

      await service.listLogs({
        actorId: "admin-1",
        resourceType: "USER",
        resourceId: "user-2",
        limit: 25,
        offset: 5,
      });

      const expectedWhere = {
        actorUserId: "admin-1",
        resourceType: "USER",
        resourceId: "user-2",
      };

      expect(findManySpy).toHaveBeenCalledWith({
        where: expectedWhere,
        orderBy: { createdAt: "desc" },
        take: 25,
        skip: 5,
        include: {
          actorUser: {
            select: {
              id: true,
              username: true,
              displayName: true,
            },
          },
        },
      });
      expect(countSpy).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it("listLogs should support positional limit and offset arguments", async () => {
      const findManySpy = vi.spyOn(prisma.auditLog, "findMany").mockResolvedValueOnce([]);
      const countSpy = vi.spyOn(prisma.auditLog, "count").mockResolvedValueOnce(0);

      await service.listLogs(15, 30);

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 15,
          skip: 30,
        })
      );
      expect(countSpy).toHaveBeenCalledWith({ where: {} });
    });

    it("listLogs should clamp limit between 1 and 100, and enforce non-negative offset", async () => {
      const findManySpy = vi.spyOn(prisma.auditLog, "findMany").mockResolvedValueOnce([]);
      vi.spyOn(prisma.auditLog, "count").mockResolvedValueOnce(0);

      await service.listLogs({ limit: 500, offset: -10 });

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
          skip: 0,
        })
      );
    });
  });

  describe("singleton export", () => {
    it("should export auditService singleton instance of AuditService", () => {
      expect(auditService).toBeInstanceOf(AuditService);
    });
  });
});
