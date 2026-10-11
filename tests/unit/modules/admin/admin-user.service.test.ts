import { describe, it, expect, vi, beforeEach } from "vitest";
import { User, UserRole, UserStatus } from "@prisma/client";
import {
  AdminUserService,
  adminUserService,
} from "../../../../src/modules/admin/services/admin-user.service";
import {
  AdminUserController,
  adminUserController,
  listUsersQuerySchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from "../../../../src/modules/admin/controllers/admin-user.controller";
import { AuditService } from "../../../../src/modules/admin/services/audit.service";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import * as outboxModule from "../../../../src/infrastructure/queue/outbox";
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from "../../../../src/shared/errors/problem-details";

describe("Admin User Moderation & Suspension", () => {
  const dummyUser: User = {
    id: "01926b48-1111-7000-8000-000000000001",
    authId: "auth-1",
    username: "alice",
    displayName: "Alice Smith",
    bio: "Hello world",
    profileImageUrl: null,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 0,
    followingCount: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  };

  describe("AdminUserService", () => {
    let mockAudit: { recordAction: ReturnType<typeof vi.fn> };
    let service: AdminUserService;
    let mockTx: any;

    beforeEach(() => {
      vi.restoreAllMocks();

      mockAudit = { recordAction: vi.fn().mockResolvedValue({}) };
      service = new AdminUserService(mockAudit as unknown as AuditService);

      mockTx = {
        user: {
          findUnique: vi.fn(),
          update: vi.fn(),
          findMany: vi.fn(),
          count: vi.fn(),
        },
        auditLog: {
          create: vi.fn(),
        },
        outboxEvent: {
          create: vi.fn(),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback(mockTx);
      });
      vi.spyOn(outboxModule, "stageOutboxEvent").mockResolvedValue(undefined as never);
    });

    describe("updateUserStatus", () => {
      it("should record audit log upon changing user status to SUSPENDED", async () => {
        vi.spyOn(service as any, "findUserById").mockResolvedValueOnce(dummyUser);
        vi.spyOn(service as any, "executeStatusUpdate").mockResolvedValueOnce({
          ...dummyUser,
          status: UserStatus.SUSPENDED,
          suspensionReason: "TOS violation",
        });

        const until = new Date("2026-12-31T00:00:00.000Z");
        const result = await service.updateUserStatus(
          "admin-1",
          dummyUser.id,
          UserStatus.SUSPENDED,
          "TOS violation",
          until
        );

        expect(service["findUserById"]).toHaveBeenCalledWith(dummyUser.id, mockTx);
        expect(service["executeStatusUpdate"]).toHaveBeenCalledWith(
          dummyUser.id,
          {
            status: UserStatus.SUSPENDED,
            suspendedAt: expect.any(Date),
            suspendedUntil: until,
            suspensionReason: "TOS violation",
          },
          mockTx
        );

        expect(mockAudit.recordAction).toHaveBeenCalledWith(
          "admin-1",
          "ADMIN_SUSPENDED_USER",
          "USER",
          dummyUser.id,
          expect.objectContaining({
            reason: "TOS violation",
            status: UserStatus.SUSPENDED,
            until: until.toISOString(),
          }),
          mockTx
        );

        expect(result.status).toBe(UserStatus.SUSPENDED);
      });

      it("should throw ValidationError if suspending without a reason", async () => {
        await expect(
          service.updateUserStatus("admin-1", dummyUser.id, UserStatus.SUSPENDED)
        ).rejects.toThrow("Suspension reason is required when suspending a user");

        await expect(
          service.updateUserStatus("admin-1", dummyUser.id, UserStatus.SUSPENDED, "   ")
        ).rejects.toThrow(ValidationError);

        expect(mockAudit.recordAction).not.toHaveBeenCalled();
      });

      it("should throw NotFoundError if user does not exist", async () => {
        vi.spyOn(service as any, "findUserById").mockResolvedValueOnce(null);

        await expect(
          service.updateUserStatus(
            "admin-1",
            "non-existent-user",
            UserStatus.SUSPENDED,
            "Violated rules"
          )
        ).rejects.toThrow(NotFoundError);

        expect(mockAudit.recordAction).not.toHaveBeenCalled();
      });

      it("should clear suspension fields and record ADMIN_ACTIVATED_USER when activating user", async () => {
        const suspendedUser: User = {
          ...dummyUser,
          status: UserStatus.SUSPENDED,
          suspendedAt: new Date(),
          suspendedUntil: new Date(),
          suspensionReason: "Prior violation",
        };

        vi.spyOn(service as any, "findUserById").mockResolvedValueOnce(suspendedUser);
        vi.spyOn(service as any, "executeStatusUpdate").mockResolvedValueOnce({
          ...dummyUser,
          status: UserStatus.ACTIVE,
          suspendedAt: null,
          suspendedUntil: null,
          suspensionReason: null,
        });

        const result = await service.updateUserStatus(
          "admin-1",
          dummyUser.id,
          UserStatus.ACTIVE,
          "Appeal accepted"
        );

        expect(service["executeStatusUpdate"]).toHaveBeenCalledWith(
          dummyUser.id,
          {
            status: UserStatus.ACTIVE,
            suspendedAt: null,
            suspendedUntil: null,
            suspensionReason: null,
            deletedAt: null,
          },
          mockTx
        );

        expect(mockAudit.recordAction).toHaveBeenCalledWith(
          "admin-1",
          "ADMIN_ACTIVATED_USER",
          "USER",
          dummyUser.id,
          expect.objectContaining({
            reason: "Appeal accepted",
            status: UserStatus.ACTIVE,
            until: undefined,
          }),
          mockTx
        );

        expect(result.status).toBe(UserStatus.ACTIVE);
      });

      it("should clear deletedAt when reactivating a deleted user to ACTIVE", async () => {
        const deletedUser: User = {
          ...dummyUser,
          status: UserStatus.DELETED,
          deletedAt: new Date("2026-01-01T00:00:00.000Z"),
        };

        vi.spyOn(service as any, "findUserById").mockResolvedValueOnce(deletedUser);
        vi.spyOn(service as any, "executeStatusUpdate").mockResolvedValueOnce({
          ...dummyUser,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        });

        const result = await service.updateUserStatus(
          "admin-1",
          dummyUser.id,
          UserStatus.ACTIVE,
          "Reinstatement after review"
        );

        expect(service["executeStatusUpdate"]).toHaveBeenCalledWith(
          dummyUser.id,
          expect.objectContaining({
            status: UserStatus.ACTIVE,
            deletedAt: null,
          }),
          mockTx
        );
        expect(result.status).toBe(UserStatus.ACTIVE);
      });

      it("should throw ValidationError when an admin attempts to suspend their own account", async () => {
        await expect(
          service.updateUserStatus(
            dummyUser.id,
            dummyUser.id,
            UserStatus.SUSPENDED,
            "Self penalty"
          )
        ).rejects.toThrow("Administrators cannot suspend or delete their own account");

        expect(mockAudit.recordAction).not.toHaveBeenCalled();
      });

      it("should throw ValidationError when an admin attempts to delete their own account", async () => {
        await expect(
          service.updateUserStatus(
            dummyUser.id,
            dummyUser.id,
            UserStatus.DELETED
          )
        ).rejects.toThrow("Administrators cannot suspend or delete their own account");

        expect(mockAudit.recordAction).not.toHaveBeenCalled();
      });

      it("should throw ValidationError when suspension until date is invalid", async () => {
        await expect(
          service.updateUserStatus(
            "admin-1",
            dummyUser.id,
            UserStatus.SUSPENDED,
            "Rule violation",
            "invalid-date-string"
          )
        ).rejects.toThrow("Invalid suspension expiration date");

        await expect(
          service.updateUserStatus(
            "admin-1",
            dummyUser.id,
            UserStatus.SUSPENDED,
            "Rule violation",
            new Date("invalid-date-string")
          )
        ).rejects.toThrow("Invalid suspension expiration date");

        expect(mockAudit.recordAction).not.toHaveBeenCalled();
      });

      it("should set deletedAt, record ADMIN_DELETED_USER, and stage UserDeleted outbox event when deleting user", async () => {
        vi.spyOn(service as any, "findUserById").mockResolvedValueOnce(dummyUser);
        vi.spyOn(service as any, "executeStatusUpdate").mockResolvedValueOnce({
          ...dummyUser,
          status: UserStatus.DELETED,
          deletedAt: new Date(),
        });

        const result = await service.updateUserStatus(
          "admin-1",
          dummyUser.id,
          UserStatus.DELETED,
          "Account deleted by staff"
        );

        expect(service["executeStatusUpdate"]).toHaveBeenCalledWith(
          dummyUser.id,
          {
            status: UserStatus.DELETED,
            deletedAt: expect.any(Date),
          },
          mockTx
        );

        expect(outboxModule.stageOutboxEvent).toHaveBeenCalledWith(
          mockTx,
          "UserDeleted",
          "User",
          dummyUser.id,
          { userId: dummyUser.id }
        );

        expect(mockAudit.recordAction).toHaveBeenCalledWith(
          "admin-1",
          "ADMIN_DELETED_USER",
          "USER",
          dummyUser.id,
          expect.objectContaining({
            reason: "Account deleted by staff",
            status: UserStatus.DELETED,
          }),
          mockTx
        );

        expect(result.status).toBe(UserStatus.DELETED);
      });

      it("should gracefully run operations in disconnected test environments when runTransaction falls back", async () => {
        vi.restoreAllMocks();
        const unmockedService = new AdminUserService(mockAudit as unknown as AuditService);

        vi.spyOn(unmockedService as any, "findUserById").mockResolvedValueOnce(dummyUser);
        vi.spyOn(unmockedService as any, "executeStatusUpdate").mockResolvedValueOnce({
          ...dummyUser,
          status: UserStatus.ACTIVE,
        });

        const res = await unmockedService.updateUserStatus(
          "admin-1",
          dummyUser.id,
          UserStatus.ACTIVE
        );
        expect(res.status).toBe(UserStatus.ACTIVE);
        expect(mockAudit.recordAction).toHaveBeenCalledWith(
          "admin-1",
          "ADMIN_ACTIVATED_USER",
          "USER",
          dummyUser.id,
          expect.any(Object),
          expect.anything()
        );
      });
    });

    describe("getUserById", () => {
      it("should return the user record if found", async () => {
        vi.spyOn(service as any, "findUserById").mockResolvedValueOnce(dummyUser);

        const result = await service.getUserById(dummyUser.id);
        expect(result).toEqual(dummyUser);
      });

      it("should throw NotFoundError if user does not exist", async () => {
        vi.spyOn(service as any, "findUserById").mockResolvedValue(null);

        await expect(service.getUserById("unknown-id")).rejects.toThrow(
          "Resource not found"
        );
        await expect(service.getUserById("unknown-id")).rejects.toBeInstanceOf(
          NotFoundError
        );
      });
    });

    describe("listUsers", () => {
      it("should return users and total count with default pagination limits", async () => {
        const findManySpy = vi
          .spyOn(prisma.user, "findMany")
          .mockResolvedValueOnce([dummyUser]);
        const countSpy = vi.spyOn(prisma.user, "count").mockResolvedValueOnce(1);

        const result = await service.listUsers();

        expect(findManySpy).toHaveBeenCalledWith({
          where: {},
          orderBy: { createdAt: "desc" },
          take: 50,
          skip: 0,
        });
        expect(countSpy).toHaveBeenCalledWith({ where: {} });
        expect(result).toEqual({ users: [dummyUser], total: 1 });
      });

      it("should apply status and search filters and clamp limit and offset", async () => {
        const findManySpy = vi
          .spyOn(prisma.user, "findMany")
          .mockResolvedValueOnce([dummyUser]);
        const countSpy = vi.spyOn(prisma.user, "count").mockResolvedValueOnce(1);

        const result = await service.listUsers({
          status: UserStatus.SUSPENDED,
          search: "  alice  ",
          limit: 200,
          offset: -5,
        });

        expect(findManySpy).toHaveBeenCalledWith({
          where: {
            status: UserStatus.SUSPENDED,
            OR: [
              { username: { contains: "alice", mode: "insensitive" } },
              { displayName: { contains: "alice", mode: "insensitive" } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 100, // clamped from 200
          skip: 0,   // clamped from -5
        });
        expect(countSpy).toHaveBeenCalledWith({
          where: {
            status: UserStatus.SUSPENDED,
            OR: [
              { username: { contains: "alice", mode: "insensitive" } },
              { displayName: { contains: "alice", mode: "insensitive" } },
            ],
          },
        });
        expect(result).toEqual({ users: [dummyUser], total: 1 });
      });
    });

    describe("internal findUserById and executeStatusUpdate helpers", () => {
      it("should call prisma client user.findUnique in findUserById", async () => {
        const spy = vi
          .spyOn(prisma.user, "findUnique")
          .mockResolvedValueOnce(dummyUser);
        const res = await (service as any).findUserById("user-1");
        expect(spy).toHaveBeenCalledWith({ where: { id: "user-1" } });
        expect(res).toEqual(dummyUser);
      });

      it("should call prisma client user.update in executeStatusUpdate", async () => {
        const spy = vi
          .spyOn(prisma.user, "update")
          .mockResolvedValueOnce(dummyUser);
        const res = await (service as any).executeStatusUpdate("user-1", {
          status: UserStatus.ACTIVE,
        });
        expect(spy).toHaveBeenCalledWith({
          where: { id: "user-1" },
          data: { status: UserStatus.ACTIVE },
        });
        expect(res).toEqual(dummyUser);
      });
    });

    describe("singleton export", () => {
      it("should export adminUserService as an instance of AdminUserService", () => {
        expect(adminUserService).toBeInstanceOf(AdminUserService);
      });
    });
  });

  describe("AdminUserController", () => {
    let mockService: {
      listUsers: ReturnType<typeof vi.fn>;
      getUserById: ReturnType<typeof vi.fn>;
      updateUserStatus: ReturnType<typeof vi.fn>;
    };
    let controller: AdminUserController;
    let mockReq: any;
    let mockRes: any;
    let next: any;

    beforeEach(() => {
      vi.restoreAllMocks();

      mockService = {
        listUsers: vi.fn(),
        getUserById: vi.fn(),
        updateUserStatus: vi.fn(),
      };
      controller = new AdminUserController(
        mockService as unknown as AdminUserService
      );

      mockReq = {
        user: { id: "admin-uuid", role: UserRole.ADMIN },
        params: {},
        query: {},
        body: {},
      };

      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      next = vi.fn();
    });

    describe("listUsers", () => {
      it("should parse query and respond 200 with listUsers result", async () => {
        mockReq.query = {
          status: "ACTIVE",
          search: "alice",
          limit: "25",
          offset: "10",
        };
        const listResult = { users: [dummyUser], total: 1 };
        mockService.listUsers.mockResolvedValueOnce(listResult);

        await controller.listUsers(mockReq, mockRes, next);

        expect(mockService.listUsers).toHaveBeenCalledWith({
          status: "ACTIVE",
          search: "alice",
          limit: 25,
          offset: 10,
        });
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(listResult);
        expect(next).not.toHaveBeenCalled();
      });

      it("should call next with ValidationError when query status is invalid", async () => {
        mockReq.query = { status: "INVALID_STATUS" };

        await controller.listUsers(mockReq, mockRes, next);

        expect(mockService.listUsers).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      });
    });

    describe("getUser", () => {
      it("should retrieve user by req.params.id and return 200", async () => {
        mockReq.params = { id: dummyUser.id };
        mockService.getUserById.mockResolvedValueOnce(dummyUser);

        await controller.getUser(mockReq, mockRes, next);

        expect(mockService.getUserById).toHaveBeenCalledWith(dummyUser.id);
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(dummyUser);
        expect(next).not.toHaveBeenCalled();
      });

      it("should support req.params.userId fallback", async () => {
        mockReq.params = { userId: dummyUser.id };
        mockService.getUserById.mockResolvedValueOnce(dummyUser);

        await controller.getUser(mockReq, mockRes, next);

        expect(mockService.getUserById).toHaveBeenCalledWith(dummyUser.id);
        expect(mockRes.status).toHaveBeenCalledWith(200);
      });

      it("should call next with ValidationError when no ID parameter is provided", async () => {
        mockReq.params = {};

        await controller.getUser(mockReq, mockRes, next);

        expect(mockService.getUserById).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      });

      it("should delegate service errors to next", async () => {
        mockReq.params = { id: "01926b48-1111-7000-8000-000000000099" };
        const notFound = new NotFoundError("Resource not found");
        mockService.getUserById.mockRejectedValueOnce(notFound);

        await controller.getUser(mockReq, mockRes, next);

        expect(next).toHaveBeenCalledWith(notFound);
      });

      it("should call next with ValidationError when req.params.id is not a valid UUID", async () => {
        mockReq.params = { id: "not-a-valid-uuid" };

        await controller.getUser(mockReq, mockRes, next);

        expect(mockService.getUserById).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      });
    });

    describe("updateUserStatus", () => {
      it("should update user status and respond 200", async () => {
        mockReq.params = { id: dummyUser.id };
        mockReq.body = {
          status: "SUSPENDED",
          reason: "Spam behavior",
          until: "2026-12-31T23:59:59.000Z",
        };
        const updatedUser = {
          ...dummyUser,
          status: UserStatus.SUSPENDED,
          suspensionReason: "Spam behavior",
        };
        mockService.updateUserStatus.mockResolvedValueOnce(updatedUser);

        await controller.updateUserStatus(mockReq, mockRes, next);

        expect(mockService.updateUserStatus).toHaveBeenCalledWith(
          "admin-uuid",
          dummyUser.id,
          UserStatus.SUSPENDED,
          "Spam behavior",
          new Date("2026-12-31T23:59:59.000Z")
        );
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(updatedUser);
        expect(next).not.toHaveBeenCalled();
      });

      it("should call next with AuthenticationError if req.user is missing", async () => {
        mockReq.user = undefined;
        mockReq.params = { id: dummyUser.id };
        mockReq.body = { status: "ACTIVE" };

        await controller.updateUserStatus(mockReq, mockRes, next);

        expect(mockService.updateUserStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
      });

      it("should call next with ValidationError if req.params has no id", async () => {
        mockReq.params = {};
        mockReq.body = { status: "ACTIVE" };

        await controller.updateUserStatus(mockReq, mockRes, next);

        expect(mockService.updateUserStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      });

      it("should call next with ValidationError when req.params.id is not a valid UUID", async () => {
        mockReq.params = { id: "not-a-valid-uuid" };
        mockReq.body = { status: "ACTIVE" };

        await controller.updateUserStatus(mockReq, mockRes, next);

        expect(mockService.updateUserStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      });

      it("should call next with ValidationError when suspending without a reason in body", async () => {
        mockReq.params = { id: dummyUser.id };
        mockReq.body = { status: "SUSPENDED" };

        await controller.updateUserStatus(mockReq, mockRes, next);

        expect(mockService.updateUserStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      });

      it("should call next with ValidationError when body status is invalid", async () => {
        mockReq.params = { id: dummyUser.id };
        mockReq.body = { status: "BANNED" };

        await controller.updateUserStatus(mockReq, mockRes, next);

        expect(mockService.updateUserStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      });

      it("should delegate service errors to next", async () => {
        mockReq.params = { id: dummyUser.id };
        mockReq.body = { status: "ACTIVE" };
        const error = new Error("DB failure");
        mockService.updateUserStatus.mockRejectedValueOnce(error);

        await controller.updateUserStatus(mockReq, mockRes, next);

        expect(next).toHaveBeenCalledWith(error);
      });
    });

    describe("singleton export", () => {
      it("should export adminUserController as an instance of AdminUserController", () => {
        expect(adminUserController).toBeInstanceOf(AdminUserController);
      });
    });
  });

  describe("Schemas", () => {
    describe("listUsersQuerySchema", () => {
      it("should parse valid query filters and coerce numbers", () => {
        const parsed = listUsersQuerySchema.safeParse({
          status: "SUSPENDED",
          search: "test",
          limit: "15",
          offset: "30",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data).toEqual({
            status: UserStatus.SUSPENDED,
            search: "test",
            limit: 15,
            offset: 30,
          });
        }
      });

      it("should supply defaults for limit and offset when omitted", () => {
        const parsed = listUsersQuerySchema.safeParse({});
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.limit).toBe(50);
          expect(parsed.data.offset).toBe(0);
        }
      });
    });

    describe("updateUserStatusSchema", () => {
      it("should accept ACTIVE without reason", () => {
        const parsed = updateUserStatusSchema.safeParse({ status: "ACTIVE" });
        expect(parsed.success).toBe(true);
      });

      it("should reject SUSPENDED without reason", () => {
        const parsed = updateUserStatusSchema.safeParse({ status: "SUSPENDED" });
        expect(parsed.success).toBe(false);
      });

      it("should accept SUSPENDED with valid reason and until date", () => {
        const parsed = updateUserStatusSchema.safeParse({
          status: "SUSPENDED",
          reason: "Spam bot",
          until: "2026-12-31T00:00:00.000Z",
        });
        expect(parsed.success).toBe(true);
      });
    });

    describe("userIdParamSchema", () => {
      it("should accept a valid UUID", () => {
        const parsed = userIdParamSchema.safeParse({
          userId: "01926b48-1111-7000-8000-000000000001",
        });
        expect(parsed.success).toBe(true);
      });

      it("should reject an invalid UUID", () => {
        const parsed = userIdParamSchema.safeParse({
          userId: "invalid-uuid",
        });
        expect(parsed.success).toBe(false);
      });
    });
  });
});
