import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { stageOutboxEvent } from "../../../infrastructure/queue/outbox";
import {
  NotFoundError,
  ValidationError,
} from "../../../shared/errors/problem-details";

export interface FollowListResult {
  data: any[];
  items: any[];
  nextCursor: string | null;
}

export class FollowService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Helper method to verify an active (non-soft-deleted) target user exists.
   * Throws NotFoundError if user does not exist or has been soft-deleted.
   */
  protected async findActiveUser(
    userId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ id: string }> {
    const client = tx ?? this.db;
    const user = await client.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    return user;
  }

  /**
   * Helper method to execute operations within a database transaction.
   */
  protected async runTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return this.db.$transaction(fn);
  }

  /**
   * Follows a target user atomically:
   * 1. Self-follow guard: throws ValidationError if followerId === followingId.
   * 2. Validates target user exists and is not soft-deleted (deletedAt === null).
   * 3. Idempotently returns if already following without double-incrementing.
   * 4. Inserts Follow record, catching P2002 unique constraint race conditions idempotently.
   * 5. Atomically increments follower's following_count and target's follower_count in SQL.
   * 6. Stages FollowCreated Transactional Outbox event.
   */
  async followUser(
    followerId: string,
    followingId: string
  ): Promise<{ following: boolean; userId: string }> {
    if (followerId === followingId) {
      const error = new ValidationError("Users cannot follow themselves");
      (error as any).code = "CANNOT_FOLLOW_SELF";
      throw error;
    }

    try {
      return await this.runTransaction(async (tx) => {
        await this.findActiveUser(followingId, tx);

        const existingFollow = await tx.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId,
              followingId,
            },
          },
        });

        if (existingFollow) {
          return { following: true, userId: followingId };
        }

        try {
          await tx.follow.create({
            data: {
              followerId,
              followingId,
            },
          });
        } catch (error: any) {
          if (
            (error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002") ||
            error?.code === "P2002"
          ) {
            return { following: true, userId: followingId };
          }
          throw error;
        }

        const [firstId, secondId] = [followerId, followingId].sort();
        for (const id of [firstId, secondId]) {
          if (id === followerId) {
            await tx.$executeRaw`UPDATE users SET following_count = following_count + 1 WHERE id = ${followerId}::uuid`;
          } else {
            await tx.$executeRaw`UPDATE users SET follower_count = follower_count + 1 WHERE id = ${followingId}::uuid`;
          }
        }

        await stageOutboxEvent(tx, "FollowCreated", "User", followingId, {
          actorId: followerId,
          recipientId: followingId,
        });

        return { following: true, userId: followingId };
      });
    } catch (error: any) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002") ||
        error?.code === "P2002"
      ) {
        return { following: true, userId: followingId };
      }
      throw error;
    }
  }

  /**
   * Unfollows a target user atomically:
   * 1. Idempotently returns if follow relationship does not exist without counter decrements.
   * 2. Physically deletes Follow record, handling P2025 idempotently.
   * 3. Decrements following_count and follower_count safely with GREATEST(count - 1, 0).
   * 4. Stages FollowRemoved Transactional Outbox event.
   */
  async unfollowUser(
    followerId: string,
    followingId: string
  ): Promise<{ following: boolean; userId: string }> {
    try {
      return await this.runTransaction(async (tx) => {
        const existingFollow = await tx.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId,
              followingId,
            },
          },
        });

        if (!existingFollow) {
          return { following: false, userId: followingId };
        }

        try {
          await tx.follow.delete({
            where: {
              followerId_followingId: {
                followerId,
                followingId,
              },
            },
          });
        } catch (error: any) {
          if (
            (error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2025") ||
            error?.code === "P2025"
          ) {
            return { following: false, userId: followingId };
          }
          throw error;
        }

        const [firstId, secondId] = [followerId, followingId].sort();
        for (const id of [firstId, secondId]) {
          if (id === followerId) {
            await tx.$executeRaw`UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = ${followerId}::uuid`;
          } else {
            await tx.$executeRaw`UPDATE users SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = ${followingId}::uuid`;
          }
        }

        await stageOutboxEvent(tx, "FollowRemoved", "User", followingId, {
          actorId: followerId,
          recipientId: followingId,
        });

        return { following: false, userId: followingId };
      });
    } catch (error: any) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025") ||
        error?.code === "P2025"
      ) {
        return { following: false, userId: followingId };
      }
      throw error;
    }
  }

  /**
   * Lists followers of a target user with cursor pagination.
   * Soft-deleted followers are excluded.
   */
  async getFollowers(
    userId: string,
    cursor?: string,
    limit: number = 20
  ): Promise<FollowListResult> {
    await this.findActiveUser(userId);

    const take = Math.max(1, Math.min(limit, 100));

    try {
      const rawFollows = await this.db.follow.findMany({
        where: {
          followingId: userId,
          follower: {
            deletedAt: null,
          },
        },
        include: {
          follower: {
            select: {
              id: true,
              username: true,
              displayName: true,
              bio: true,
              profileImageUrl: true,
              followerCount: true,
              followingCount: true,
              createdAt: true,
            },
          },
        },
        orderBy: [
          { createdAt: "desc" },
          { followerId: "desc" },
        ],
        take: take + 1,
        ...(cursor
          ? {
              cursor: {
                followerId_followingId: {
                  followerId: cursor,
                  followingId: userId,
                },
              },
              skip: 1,
            }
          : {}),
      });

      const hasMore = rawFollows.length > take;
      const data = hasMore ? rawFollows.slice(0, take) : rawFollows;
      const mapped = data.map((item) => ({
        ...item,
        user: item.follower,
      }));
      const nextCursor =
        hasMore && data.length > 0 ? data[data.length - 1].followerId : null;

      return {
        data: mapped,
        items: mapped,
        nextCursor,
      };
    } catch (error: any) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025") ||
        error?.code === "P2025"
      ) {
        return {
          data: [],
          items: [],
          nextCursor: null,
        };
      }
      throw error;
    }
  }

  /**
   * Lists users that the target user is following with cursor pagination.
   * Soft-deleted following users are excluded.
   */
  async getFollowing(
    userId: string,
    cursor?: string,
    limit: number = 20
  ): Promise<FollowListResult> {
    await this.findActiveUser(userId);

    const take = Math.max(1, Math.min(limit, 100));

    try {
      const rawFollows = await this.db.follow.findMany({
        where: {
          followerId: userId,
          following: {
            deletedAt: null,
          },
        },
        include: {
          following: {
            select: {
              id: true,
              username: true,
              displayName: true,
              bio: true,
              profileImageUrl: true,
              followerCount: true,
              followingCount: true,
              createdAt: true,
            },
          },
        },
        orderBy: [
          { createdAt: "desc" },
          { followingId: "desc" },
        ],
        take: take + 1,
        ...(cursor
          ? {
              cursor: {
                followerId_followingId: {
                  followerId: userId,
                  followingId: cursor,
                },
              },
              skip: 1,
            }
          : {}),
      });

      const hasMore = rawFollows.length > take;
      const data = hasMore ? rawFollows.slice(0, take) : rawFollows;
      const mapped = data.map((item) => ({
        ...item,
        user: item.following,
      }));
      const nextCursor =
        hasMore && data.length > 0 ? data[data.length - 1].followingId : null;

      return {
        data: mapped,
        items: mapped,
        nextCursor,
      };
    } catch (error: any) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025") ||
        error?.code === "P2025"
      ) {
        return {
          data: [],
          items: [],
          nextCursor: null,
        };
      }
      throw error;
    }
  }
}
