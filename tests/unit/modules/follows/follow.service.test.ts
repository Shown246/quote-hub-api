import { describe, it, expect, vi, beforeEach } from "vitest";
import { FollowService } from "../../../../src/modules/follows/services/follow.service";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import * as outboxModule from "../../../../src/infrastructure/queue/outbox";
import {
  ValidationError,
  NotFoundError,
} from "../../../../src/shared/errors/problem-details";

describe("FollowService", () => {
  let service: FollowService;
  let mockTx: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockTx = {
      user: {
        findFirst: vi.fn(),
      },
      follow: {
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
      },
      $executeRaw: vi.fn(),
      outboxEvent: {
        create: vi.fn(),
      },
    };

    // When prisma.$transaction is invoked, route callback with mockTx
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      return callback(mockTx);
    });

    service = new FollowService(prisma as any);
  });

  describe("Self-Follow Guard", () => {
    it("should throw ValidationError when user attempts to follow themselves", async () => {
      await expect(
        service.followUser("user-same", "user-same")
      ).rejects.toThrow("Users cannot follow themselves");

      await expect(
        service.followUser("user-same", "user-same")
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("findActiveUser helper", () => {
    it("should return user when active user exists", async () => {
      mockTx.user.findFirst.mockResolvedValueOnce({ id: "target-user-123" });

      const user = await (service as any).findActiveUser("target-user-123", mockTx);
      expect(user).toEqual({ id: "target-user-123" });
      expect(mockTx.user.findFirst).toHaveBeenCalledWith({
        where: { id: "target-user-123", deletedAt: null },
        select: { id: true },
      });
    });

    it("should throw NotFoundError when target user does not exist or is soft-deleted", async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);

      await expect(
        (service as any).findActiveUser("missing-user", mockTx)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("followUser", () => {
    const followerId = "01925b6a-9321-789a-b456-follower0000";
    const followingId = "01925b6a-9321-789a-b456-target000000";

    it("should throw NotFoundError if target user does not exist", async () => {
      mockTx.user.findFirst.mockResolvedValueOnce(null);

      await expect(service.followUser(followerId, followingId)).rejects.toThrow(
        "User not found"
      );
      expect(mockTx.follow.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it("should successfully follow user, atomically increment follower & following counters, and stage FollowCreated outbox event", async () => {
      mockTx.user.findFirst.mockResolvedValueOnce({ id: followingId });
      mockTx.follow.findUnique.mockResolvedValueOnce(null);
      mockTx.follow.create.mockResolvedValueOnce({
        followerId,
        followingId,
        createdAt: new Date(),
      });
      mockTx.$executeRaw.mockResolvedValue(1);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.followUser(followerId, followingId);

      expect(result).toEqual({ following: true, userId: followingId });

      // 1. Follow record inserted
      expect(mockTx.follow.create).toHaveBeenCalledWith({
        data: { followerId, followingId },
      });

      // 2. Both counters incremented
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);

      // 3. Outbox event staged
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "FollowCreated",
        "User",
        followingId,
        {
          actorId: followerId,
          recipientId: followingId,
        }
      );
    });

    it("should idempotently handle duplicate follow without double-incrementing counters or staging duplicate event", async () => {
      mockTx.user.findFirst.mockResolvedValueOnce({ id: followingId });
      mockTx.follow.findUnique.mockResolvedValueOnce({
        followerId,
        followingId,
        createdAt: new Date(),
      });

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.followUser(followerId, followingId);

      expect(result).toEqual({ following: true, userId: followingId });
      expect(mockTx.follow.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently handle concurrent P2002 unique constraint race condition during follow creation", async () => {
      mockTx.user.findFirst.mockResolvedValueOnce({ id: followingId });
      mockTx.follow.findUnique.mockResolvedValueOnce(null);

      const p2002Error = new Error("Unique constraint failed");
      (p2002Error as any).code = "P2002";
      mockTx.follow.create.mockRejectedValueOnce(p2002Error);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.followUser(followerId, followingId);

      expect(result).toEqual({ following: true, userId: followingId });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should update counters in canonical order by user ID to prevent deadlocks when followingId < followerId", async () => {
      const userA = "00000000-0000-0000-0000-000000000001";
      const userB = "00000000-0000-0000-0000-000000000002";

      // followerId = userB, followingId = userA (followingId < followerId)
      mockTx.user.findFirst.mockResolvedValueOnce({ id: userA });
      mockTx.follow.findUnique.mockResolvedValueOnce(null);
      mockTx.follow.create.mockResolvedValueOnce({
        followerId: userB,
        followingId: userA,
        createdAt: new Date(),
      });
      mockTx.$executeRaw.mockResolvedValue(1);

      await service.followUser(userB, userA);

      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
      // Canonical order: userA first, then userB
      // Call 1: userA's follower_count
      expect(mockTx.$executeRaw.mock.calls[0][1]).toBe(userA);
      expect(mockTx.$executeRaw.mock.calls[0][0][0]).toContain("follower_count");
      // Call 2: userB's following_count
      expect(mockTx.$executeRaw.mock.calls[1][1]).toBe(userB);
      expect(mockTx.$executeRaw.mock.calls[1][0][0]).toContain("following_count");
    });
  });

  describe("unfollowUser", () => {
    const followerId = "01925b6a-9321-789a-b456-follower0000";
    const followingId = "01925b6a-9321-789a-b456-target000000";

    it("should successfully unfollow user, decrement counters with GREATEST, and stage FollowRemoved outbox event", async () => {
      mockTx.follow.findUnique.mockResolvedValueOnce({
        followerId,
        followingId,
        createdAt: new Date(),
      });
      mockTx.follow.delete.mockResolvedValueOnce({
        followerId,
        followingId,
      });
      mockTx.$executeRaw.mockResolvedValue(1);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unfollowUser(followerId, followingId);

      expect(result).toEqual({ following: false, userId: followingId });

      // 1. Physically delete Follow record
      expect(mockTx.follow.delete).toHaveBeenCalledWith({
        where: {
          followerId_followingId: {
            followerId,
            followingId,
          },
        },
      });

      // 2. Both counters decremented with GREATEST
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);

      // 3. Outbox event staged
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "FollowRemoved",
        "User",
        followingId,
        {
          actorId: followerId,
          recipientId: followingId,
        }
      );
    });

    it("should idempotently handle unfollow when relationship did not exist without counter decrement or outbox event", async () => {
      mockTx.follow.findUnique.mockResolvedValueOnce(null);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unfollowUser(followerId, followingId);

      expect(result).toEqual({ following: false, userId: followingId });
      expect(mockTx.follow.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently handle P2025 error on concurrent delete", async () => {
      mockTx.follow.findUnique.mockResolvedValueOnce({
        followerId,
        followingId,
      });
      const p2025Error = new Error("Record to delete does not exist");
      (p2025Error as any).code = "P2025";
      mockTx.follow.delete.mockRejectedValueOnce(p2025Error);

      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const result = await service.unfollowUser(followerId, followingId);

      expect(result).toEqual({ following: false, userId: followingId });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should decrement counters in canonical order by user ID to prevent deadlocks when followingId < followerId", async () => {
      const userA = "00000000-0000-0000-0000-000000000001";
      const userB = "00000000-0000-0000-0000-000000000002";

      // followerId = userB, followingId = userA (followingId < followerId)
      mockTx.follow.findUnique.mockResolvedValueOnce({
        followerId: userB,
        followingId: userA,
        createdAt: new Date(),
      });
      mockTx.follow.delete.mockResolvedValueOnce({
        followerId: userB,
        followingId: userA,
      });
      mockTx.$executeRaw.mockResolvedValue(1);

      await service.unfollowUser(userB, userA);

      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
      // Canonical order: userA first, then userB
      // Call 1: userA's follower_count
      expect(mockTx.$executeRaw.mock.calls[0][1]).toBe(userA);
      expect(mockTx.$executeRaw.mock.calls[0][0][0]).toContain("follower_count");
      // Call 2: userB's following_count
      expect(mockTx.$executeRaw.mock.calls[1][1]).toBe(userB);
      expect(mockTx.$executeRaw.mock.calls[1][0][0]).toContain("following_count");
    });
  });

  describe("getFollowers", () => {
    const targetUserId = "01925b6a-9321-789a-b456-target000000";

    it("should throw NotFoundError if target user does not exist", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      await expect(service.getFollowers(targetUserId)).rejects.toThrow("User not found");
    });

    it("should return paginated followers excluding soft-deleted users", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({ id: targetUserId } as any);

      const mockFollows = [
        {
          followerId: "user-1",
          followingId: targetUserId,
          createdAt: new Date("2026-03-02T00:00:00Z"),
          follower: {
            id: "user-1",
            username: "user_one",
            displayName: "User One",
            profileImageUrl: null,
            bio: "Bio 1",
            followerCount: 0,
            followingCount: 1,
            createdAt: new Date(),
          },
        },
        {
          followerId: "user-2",
          followingId: targetUserId,
          createdAt: new Date("2026-03-01T00:00:00Z"),
          follower: {
            id: "user-2",
            username: "user_two",
            displayName: "User Two",
            profileImageUrl: null,
            bio: "Bio 2",
            followerCount: 5,
            followingCount: 2,
            createdAt: new Date(),
          },
        },
      ];

      vi.spyOn(prisma.follow, "findMany").mockResolvedValueOnce(mockFollows as any);

      const result = await service.getFollowers(targetUserId, undefined, 1);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].followerId).toBe("user-1");
      expect(result.data[0].user).toEqual(mockFollows[0].follower);
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe("user-1");
    });

    it("should return empty list when cursor is invalid (P2025)", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({ id: targetUserId } as any);

      const p2025Error = new Error("Cursor record not found");
      (p2025Error as any).code = "P2025";
      vi.spyOn(prisma.follow, "findMany").mockRejectedValueOnce(p2025Error);

      const result = await service.getFollowers(targetUserId, "invalid-cursor", 20);

      expect(result).toEqual({ data: [], items: [], nextCursor: null });
    });
  });

  describe("getFollowing", () => {
    const targetUserId = "01925b6a-9321-789a-b456-target000000";

    it("should throw NotFoundError if target user does not exist", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      await expect(service.getFollowing(targetUserId)).rejects.toThrow("User not found");
    });

    it("should return paginated following users excluding soft-deleted users", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({ id: targetUserId } as any);

      const mockFollows = [
        {
          followerId: targetUserId,
          followingId: "user-a",
          createdAt: new Date("2026-03-02T00:00:00Z"),
          following: {
            id: "user-a",
            username: "user_a",
            displayName: "User A",
            profileImageUrl: null,
            bio: "Bio A",
            followerCount: 10,
            followingCount: 5,
            createdAt: new Date(),
          },
        },
        {
          followerId: targetUserId,
          followingId: "user-b",
          createdAt: new Date("2026-03-01T00:00:00Z"),
          following: {
            id: "user-b",
            username: "user_b",
            displayName: "User B",
            profileImageUrl: null,
            bio: "Bio B",
            followerCount: 20,
            followingCount: 15,
            createdAt: new Date(),
          },
        },
      ];

      vi.spyOn(prisma.follow, "findMany").mockResolvedValueOnce(mockFollows as any);

      const result = await service.getFollowing(targetUserId, undefined, 1);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].followingId).toBe("user-a");
      expect(result.data[0].user).toEqual(mockFollows[0].following);
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBe("user-a");
    });

    it("should return empty list when cursor is invalid (P2025)", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({ id: targetUserId } as any);

      const p2025Error = new Error("Cursor record not found");
      (p2025Error as any).code = "P2025";
      vi.spyOn(prisma.follow, "findMany").mockRejectedValueOnce(p2025Error);

      const result = await service.getFollowing(targetUserId, "invalid-cursor", 20);

      expect(result).toEqual({ data: [], items: [], nextCursor: null });
    });
  });
});
