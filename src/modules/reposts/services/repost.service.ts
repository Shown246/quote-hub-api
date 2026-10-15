import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { stageOutboxEvent } from "../../../infrastructure/queue/outbox";
import { generateUuidV7 } from "../../../shared/utils/uuidv7";
import { NotFoundError, ValidationError } from "../../../shared/errors/problem-details";
import { invalidateCache } from "../../../infrastructure/redis/cache";
import { encodeCursor, decodeCursor } from "../../../shared/utils/cursor";

export class RepostService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Helper method to retrieve an active (non-soft-deleted) quote within a transaction boundary.
   * Returns the quote with its id and owner userId, or null if not found / soft-deleted.
   */
  protected async findActiveQuote(
    quoteId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{ id: string; userId: string } | null> {
    const client = tx ?? this.db;
    return client.quote.findFirst({
      where: {
        id: quoteId,
        deletedAt: null,
      },
      select: {
        id: true,
        userId: true,
      },
    });
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
   * Reposts a quote atomically:
   * 1. Validates quote exists and is not soft-deleted (deletedAt === null).
   * 2. Idempotently returns if already reposted without double-incrementing.
   * 3. Inserts Repost record with UUIDv7 id, catching P2002 unique constraint race conditions idempotently.
   * 4. Atomically increments repost_count on quotes table.
   * 5. Stages RepostCreated Transactional Outbox event.
   */
  async repostQuote(
    userId: string,
    quoteId: string
  ): Promise<{ reposted: boolean; quoteId: string }> {
    try {
      const result = await this.runTransaction(async (tx) => {
        const quote = await this.findActiveQuote(quoteId, tx);

        if (!quote) {
          throw new NotFoundError("Resource not found");
        }

        const existingRepost = await tx.repost.findUnique({
          where: {
            uq_reposts_user_quote: {
              userId,
              quoteId,
            },
          },
        });

        if (existingRepost) {
          return { reposted: true, quoteId };
        }

        const id = generateUuidV7();

        try {
          await tx.repost.create({
            data: {
              id,
              userId,
              quoteId,
            },
          });
        } catch (error: any) {
          if (
            (error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002") ||
            error?.code === "P2002"
          ) {
            return { reposted: true, quoteId };
          }
          throw error;
        }

        await tx.$executeRaw`UPDATE quotes SET repost_count = repost_count + 1 WHERE id = ${quoteId}::uuid`;

        await stageOutboxEvent(tx, "RepostCreated", "Quote", quoteId, {
          actorId: userId,
          quoteId,
          recipientId: quote.userId,
        });

        return { reposted: true, quoteId };
      });

      await invalidateCache(`cache:quote:${quoteId}`);
      return result;
    } catch (error: any) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002") ||
        error?.code === "P2002"
      ) {
        return { reposted: true, quoteId };
      }
      throw error;
    }
  }

  /**
   * Unreposts a quote atomically:
   * 1. Validates quote exists and is not soft-deleted.
   * 2. Idempotently returns if repost did not exist without counter decrement.
   * 3. Physically deletes Repost record.
   * 4. Decrements repost_count safely with GREATEST(repost_count - 1, 0).
   * 5. Stages RepostRemoved Transactional Outbox event.
   */
  async unrepostQuote(
    userId: string,
    quoteId: string
  ): Promise<{ reposted: boolean; quoteId: string }> {
    try {
      const result = await this.runTransaction(async (tx) => {
        const quote = await this.findActiveQuote(quoteId, tx);

        if (!quote) {
          throw new NotFoundError("Resource not found");
        }

        const existingRepost = await tx.repost.findUnique({
          where: {
            uq_reposts_user_quote: {
              userId,
              quoteId,
            },
          },
        });

        if (!existingRepost) {
          return { reposted: false, quoteId };
        }

        try {
          await tx.repost.delete({
            where: {
              uq_reposts_user_quote: {
                userId,
                quoteId,
              },
            },
          });
        } catch (error: any) {
          if (
            (error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2025") ||
            error?.code === "P2025"
          ) {
            return { reposted: false, quoteId };
          }
          throw error;
        }

        await tx.$executeRaw`UPDATE quotes SET repost_count = GREATEST(repost_count - 1, 0) WHERE id = ${quoteId}::uuid`;

        await stageOutboxEvent(tx, "RepostRemoved", "Quote", quoteId, {
          actorId: userId,
          quoteId,
        });

        return { reposted: false, quoteId };
      });

      await invalidateCache(`cache:quote:${quoteId}`);
      return result;
    } catch (error: any) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025") ||
        error?.code === "P2025"
      ) {
        return { reposted: false, quoteId };
      }
      throw error;
    }
  }

  /**
   * Retrieves quotes reposted by a specific user with cursor pagination.
   * Resolves identifier by UUID or by username.
   * Excludes soft-deleted quotes and accounts.
   *
   * @param identifier User ID (UUID) or username handle
   * @param cursor Optional base64url cursor
   * @param limit Maximum number of quotes to return (default 20, max 100)
   * @throws NotFoundError if the user is not found or soft-deleted
   * @throws ValidationError if the cursor is malformed
   */
  async listUserReposts(
    identifier: string,
    cursor?: string,
    limit: number = 20
  ): Promise<{
    data: any[];
    pagination: { nextCursor: string | null; hasMore: boolean };
  }> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        identifier
      );
    let user = null;
    if (isUuid) {
      user = await this.db.user.findFirst({
        where: { id: identifier, deletedAt: null, status: { not: "DELETED" } },
      });
    }
    if (!user) {
      user = await this.db.user.findFirst({
        where: { username: identifier, deletedAt: null, status: { not: "DELETED" } },
      });
    }

    if (!user) {
      throw new NotFoundError("Resource not found");
    }

    const take = Math.max(1, Math.min(limit, 100));
    let decodedCursor: { createdAt: Date; id: string } | undefined;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        throw new ValidationError("Invalid pagination cursor");
      }
      decodedCursor = decoded;
    }

    const where: Prisma.RepostWhereInput = {
      userId: user.id,
      quote: {
        deletedAt: null,
      },
    };

    if (decodedCursor) {
      where.OR = [
        { createdAt: { lt: decodedCursor.createdAt } },
        { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.id } },
      ];
    }

    const rows = await this.db.repost.findMany({
      where,
      include: {
        quote: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                profileImageUrl: true,
              },
            },
            theme: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const pagedRows = hasMore ? rows.slice(0, take) : rows;
    let nextCursor: string | null = null;
    if (hasMore && pagedRows.length > 0) {
      const last = pagedRows[pagedRows.length - 1];
      nextCursor = encodeCursor(last.createdAt, last.id);
    }

    const data = pagedRows.map((row) => ({
      ...row.quote,
      themeKey: row.quote.theme?.key,
      reposted: true,
    }));

    return {
      data,
      pagination: {
        nextCursor,
        hasMore,
      },
    };
  }
}
