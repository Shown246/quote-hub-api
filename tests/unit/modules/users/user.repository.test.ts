import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { UserRepository } from "../../../../src/modules/users/repositories/user.repository";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import { ConflictError } from "../../../../src/shared/errors/problem-details";
import { isValidUuidV7 } from "../../../../src/shared/utils/uuidv7";

describe("UserRepository", () => {
  const repo = new UserRepository();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-123",
    username: "johndoe",
    displayName: "John Doe",
    bio: "Hello world",
    profileImageUrl: "https://example.com/avatar.webp",
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 0,
    followingCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  describe("findByUsername", () => {
    it("findByUsername should exclude soft-deleted users by default", async () => {
      const spy = vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);
      const result = await repo.findByUsername("deleted_user");

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            username: "deleted_user",
            deletedAt: null,
          }),
        })
      );
      expect(result).toBeNull();
    });

    it("should include soft-deleted users when includeDeleted is true", async () => {
      const spy = vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockUser);
      const result = await repo.findByUsername("johndoe", true);

      expect(spy).toHaveBeenCalledWith({
        where: { username: "johndoe" },
      });
      expect(result).toEqual(mockUser);
    });

    it("should return the user entity when found", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockUser);
      const result = await repo.findByUsername("johndoe");

      expect(result).toEqual(mockUser);
    });
  });

  describe("findById", () => {
    it("should filter by deletedAt: null by default using findFirst", async () => {
      const spy = vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockUser);
      const result = await repo.findById(mockUser.id);

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockUser.id, deletedAt: null },
      });
      expect(result).toEqual(mockUser);
    });

    it("should use findUnique without deletedAt filter when includeDeleted is true", async () => {
      const spy = vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce(mockUser);
      const result = await repo.findById(mockUser.id, true);

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      });
      expect(result).toEqual(mockUser);
    });

    it("should return null when user is not found", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);
      const result = await repo.findById("non-existent-id");

      expect(result).toBeNull();
    });
  });

  describe("findByAuthId", () => {
    it("should filter by deletedAt: null by default using findFirst", async () => {
      const spy = vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockUser);
      const result = await repo.findByAuthId("auth-123");

      expect(spy).toHaveBeenCalledWith({
        where: { authId: "auth-123", deletedAt: null },
      });
      expect(result).toEqual(mockUser);
    });

    it("should use findUnique without deletedAt filter when includeDeleted is true", async () => {
      const spy = vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce(mockUser);
      const result = await repo.findByAuthId("auth-123", true);

      expect(spy).toHaveBeenCalledWith({
        where: { authId: "auth-123" },
      });
      expect(result).toEqual(mockUser);
    });

    it("should return null when auth user is not linked to any domain user", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);
      const result = await repo.findByAuthId("unlinked-auth-id");

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("should generate a valid UUIDv7 for id if not provided", async () => {
      const spy = vi.spyOn(prisma.user, "create").mockResolvedValueOnce(mockUser);

      await repo.create({
        username: "newuser",
        displayName: "New User",
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: "newuser",
            displayName: "New User",
            authId: null,
            bio: null,
            profileImageUrl: null,
          }),
        })
      );

      const calledData = spy.mock.calls[0][0].data;
      expect(isValidUuidV7(calledData.id)).toBe(true);
    });

    it("should use the provided id when specified", async () => {
      const customId = "01925b6a-9321-789a-b456-customuuidv7";
      const spy = vi.spyOn(prisma.user, "create").mockResolvedValueOnce(mockUser);

      await repo.create({
        id: customId,
        authId: "auth-456",
        username: "customuser",
        displayName: "Custom User",
        bio: "My bio",
        profileImageUrl: "https://example.com/pic.webp",
      });

      expect(spy).toHaveBeenCalledWith({
        data: {
          id: customId,
          authId: "auth-456",
          username: "customuser",
          displayName: "Custom User",
          bio: "My bio",
          profileImageUrl: "https://example.com/pic.webp",
        },
      });
    });

    it("should catch Prisma P2002 unique constraint violations and throw ConflictError", async () => {
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`username`)",
        {
          code: "P2002",
          clientVersion: "5.20.0",
        }
      );
      vi.spyOn(prisma.user, "create").mockRejectedValueOnce(p2002Error);

      await expect(
        repo.create({
          username: "taken_user",
          displayName: "Taken User",
        })
      ).rejects.toThrow(ConflictError);

      await vi.spyOn(prisma.user, "create").mockRejectedValueOnce(p2002Error);
      await expect(
        repo.create({
          username: "taken_user",
          displayName: "Taken User",
        })
      ).rejects.toMatchObject({
        status: 409,
        code: "CONFLICT",
        detail: "Username already taken",
      });
    });

    it("should rethrow other unexpected errors during creation", async () => {
      const dbError = new Error("Connection failed");
      vi.spyOn(prisma.user, "create").mockRejectedValueOnce(dbError);

      await expect(
        repo.create({
          username: "dbfail",
          displayName: "DB Fail",
        })
      ).rejects.toThrow("Connection failed");
    });
  });

  describe("updateProfile", () => {
    it("should update only allowed profile presentation fields (mass assignment protection)", async () => {
      const spy = vi.spyOn(prisma.user, "update").mockResolvedValueOnce(mockUser);

      const updatePayload = {
        displayName: "Updated Name",
        bio: "Updated Bio",
        profileImageUrl: "https://example.com/new.webp",
        // Extraneous fields that must not be passed to Prisma
        role: "ADMIN",
        status: "DELETED",
        followerCount: 9999,
      } as unknown as { displayName?: string; bio?: string | null; profileImageUrl?: string | null };

      await repo.updateProfile(mockUser.id, updatePayload);

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: {
          displayName: "Updated Name",
          bio: "Updated Bio",
          profileImageUrl: "https://example.com/new.webp",
        },
      });
    });

    it("should only include provided fields in the update payload", async () => {
      const spy = vi.spyOn(prisma.user, "update").mockResolvedValueOnce(mockUser);

      await repo.updateProfile(mockUser.id, {
        displayName: "Just Name",
      });

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: {
          displayName: "Just Name",
        },
      });
    });

    it("should support setting bio or profileImageUrl to null", async () => {
      const spy = vi.spyOn(prisma.user, "update").mockResolvedValueOnce(mockUser);

      await repo.updateProfile(mockUser.id, {
        bio: null,
        profileImageUrl: null,
      });

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: {
          bio: null,
          profileImageUrl: null,
        },
      });
    });
  });

  describe("softDelete", () => {
    it("should update status to DELETED and set deletedAt timestamp", async () => {
      const spy = vi.spyOn(prisma.user, "update").mockResolvedValueOnce({
        ...mockUser,
        status: "DELETED" as const,
        deletedAt: new Date(),
      });

      const result = await repo.softDelete(mockUser.id);

      expect(spy).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: {
          status: "DELETED",
          deletedAt: expect.any(Date),
        },
      });
      expect(result.status).toBe("DELETED");
      expect(result.deletedAt).toBeInstanceOf(Date);
    });
  });
});
