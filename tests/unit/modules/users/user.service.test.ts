import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserService } from "../../../../src/modules/users/services/user.service";
import { UserRepository } from "../../../../src/modules/users/repositories/user.repository";
import {
  usernameSchema,
  updateProfileSchema,
} from "../../../../src/modules/users/schemas/user.schemas";
import {
  NotFoundError,
  ValidationError,
} from "../../../../src/shared/errors/problem-details";
import { User, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import * as outboxModule from "../../../../src/infrastructure/queue/outbox";

describe("User Profile Schemas", () => {
  describe("usernameSchema", () => {
    it("should accept valid usernames (alphanumeric and underscores, 3-30 chars)", () => {
      expect(usernameSchema.safeParse("abc").success).toBe(true);
      expect(usernameSchema.safeParse("user_123").success).toBe(true);
      expect(usernameSchema.safeParse("valid_handle_name").success).toBe(true);
      expect(usernameSchema.safeParse("a".repeat(30)).success).toBe(true);
    });

    it("should reject usernames shorter than 3 characters", () => {
      const result = usernameSchema.safeParse("ab");
      expect(result.success).toBe(false);
    });

    it("should reject usernames longer than 30 characters", () => {
      const result = usernameSchema.safeParse("a".repeat(31));
      expect(result.success).toBe(false);
    });

    it("should reject usernames with disallowed characters", () => {
      expect(usernameSchema.safeParse("user-name").success).toBe(false);
      expect(usernameSchema.safeParse("user.name").success).toBe(false);
      expect(usernameSchema.safeParse("user@name").success).toBe(false);
      expect(usernameSchema.safeParse("user name").success).toBe(false);
    });
  });

  describe("updateProfileSchema", () => {
    it("should accept valid presentation fields", () => {
      const result = updateProfileSchema.safeParse({
        displayName: "Ada Lovelace",
        bio: "First computer programmer",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe("Ada Lovelace");
        expect(result.data.bio).toBe("First computer programmer");
      }
    });

    it("should trim displayName", () => {
      const result = updateProfileSchema.safeParse({
        displayName: "   Ada Lovelace   ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe("Ada Lovelace");
      }
    });

    it("should accept null bio", () => {
      const result = updateProfileSchema.safeParse({
        bio: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bio).toBeNull();
      }
    });

    it("should reject empty displayName after trim", () => {
      const result = updateProfileSchema.safeParse({
        displayName: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("should reject displayName longer than 50 characters", () => {
      const result = updateProfileSchema.safeParse({
        displayName: "a".repeat(51),
      });
      expect(result.success).toBe(false);
    });

    it("should reject bio longer than 160 characters", () => {
      const result = updateProfileSchema.safeParse({
        bio: "a".repeat(161),
      });
      expect(result.success).toBe(false);
    });

    it("should reject extra properties due to strict mode", () => {
      const result = updateProfileSchema.safeParse({
        displayName: "Ada",
        role: "ADMIN",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("UserService", () => {
  const dummyUser: User = {
    id: "019266f8-4567-7000-8000-000000000001",
    authId: "better_auth_user_1",
    username: "adalovelace",
    displayName: "Ada Lovelace",
    bio: "Pioneer of computing",
    profileImageUrl: "https://example.com/avatar.webp",
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    followerCount: 0,
    followingCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockRepo = {
    findByUsername: vi.fn(),
    findById: vi.fn(),
    findByAuthId: vi.fn(),
    create: vi.fn(),
    updateProfile: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as UserRepository;

  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserService(mockRepo);
  });

  describe("getProfileByUsername", () => {
    it("should throw NotFoundError when user does not exist", async () => {
      vi.mocked(mockRepo.findByUsername).mockResolvedValueOnce(null);

      await expect(service.getProfileByUsername("missing_handle")).rejects.toThrow(
        "Resource not found"
      );
      await expect(service.getProfileByUsername("missing_handle")).rejects.toBeInstanceOf(
        NotFoundError
      );
      expect(mockRepo.findByUsername).toHaveBeenCalledWith("missing_handle");
    });

    it("should return user when found", async () => {
      vi.mocked(mockRepo.findByUsername).mockResolvedValueOnce(dummyUser);

      const result = await service.getProfileByUsername("adalovelace");
      expect(result).toEqual(dummyUser);
      expect(mockRepo.findByUsername).toHaveBeenCalledWith("adalovelace");
    });
  });

  describe("updateProfile", () => {
    it("should successfully update profile when user exists and payload is valid", async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce(dummyUser);
      const updatedUser: User = {
        ...dummyUser,
        displayName: "Augusta Ada King",
        bio: "Countess of Lovelace",
      };
      vi.mocked(mockRepo.updateProfile).mockResolvedValueOnce(updatedUser);

      const updateData = {
        displayName: "Augusta Ada King",
        bio: "Countess of Lovelace",
      };

      const result = await service.updateProfile(dummyUser.id, updateData);

      expect(mockRepo.findById).toHaveBeenCalledWith(dummyUser.id);
      expect(mockRepo.updateProfile).toHaveBeenCalledWith(dummyUser.id, {
        displayName: "Augusta Ada King",
        bio: "Countess of Lovelace",
      });
      expect(result).toEqual(updatedUser);
    });

    it("should allow updating only displayName and trimming it", async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce(dummyUser);
      vi.mocked(mockRepo.updateProfile).mockResolvedValueOnce({
        ...dummyUser,
        displayName: "Ada",
      });

      await service.updateProfile(dummyUser.id, { displayName: "  Ada  " });

      expect(mockRepo.updateProfile).toHaveBeenCalledWith(dummyUser.id, {
        displayName: "Ada",
      });
    });

    it("should allow setting bio to null", async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce(dummyUser);
      vi.mocked(mockRepo.updateProfile).mockResolvedValueOnce({
        ...dummyUser,
        bio: null,
      });

      await service.updateProfile(dummyUser.id, { bio: null });

      expect(mockRepo.updateProfile).toHaveBeenCalledWith(dummyUser.id, {
        bio: null,
      });
    });

    it("should throw ValidationError when disallowed extra fields are present", async () => {
      await expect(
        service.updateProfile(dummyUser.id, {
          displayName: "Ada",
          role: "ADMIN",
        })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mockRepo.findById).not.toHaveBeenCalled();
      expect(mockRepo.updateProfile).not.toHaveBeenCalled();
    });

    it("should throw ValidationError when displayName is empty", async () => {
      await expect(
        service.updateProfile(dummyUser.id, { displayName: "   " })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mockRepo.findById).not.toHaveBeenCalled();
      expect(mockRepo.updateProfile).not.toHaveBeenCalled();
    });

    it("should throw ValidationError when bio exceeds 160 characters", async () => {
      await expect(
        service.updateProfile(dummyUser.id, { bio: "x".repeat(161) })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mockRepo.findById).not.toHaveBeenCalled();
      expect(mockRepo.updateProfile).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError when user does not exist", async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce(null);

      await expect(
        service.updateProfile("non-existent-user-id", { displayName: "New Name" })
      ).rejects.toThrow("Resource not found");

      expect(mockRepo.findById).toHaveBeenCalledWith("non-existent-user-id");
      expect(mockRepo.updateProfile).not.toHaveBeenCalled();
    });
  });

  describe("softDeleteAccount", () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        outboxEvent: {
          create: vi.fn(),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback(mockTx);
      });
      vi.spyOn(outboxModule, "stageOutboxEvent");
    });

    it("should successfully soft delete user within a transaction and stage UserDeleted outbox event", async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(dummyUser);
      const deletedUser: User = {
        ...dummyUser,
        status: UserStatus.DELETED,
        deletedAt: new Date(),
      };
      mockTx.user.update.mockResolvedValueOnce(deletedUser);

      const result = await service.softDeleteAccount(dummyUser.id);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: dummyUser.id,
          deletedAt: null,
        },
      });
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: dummyUser.id },
        data: {
          status: UserStatus.DELETED,
          deletedAt: expect.any(Date),
        },
      });
      expect(outboxModule.stageOutboxEvent).toHaveBeenCalledWith(
        mockTx,
        "UserDeleted",
        "User",
        dummyUser.id,
        { userId: dummyUser.id }
      );
      expect(result).toEqual(deletedUser);
    });

    it("should throw NotFoundError when user does not exist in transaction and not stage outbox event", async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.softDeleteAccount("non-existent-user-id")
      ).rejects.toThrow("Resource not found");

      expect(mockTx.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: "non-existent-user-id",
          deletedAt: null,
        },
      });
      expect(mockTx.user.update).not.toHaveBeenCalled();
      expect(outboxModule.stageOutboxEvent).not.toHaveBeenCalled();
    });
  });
});
