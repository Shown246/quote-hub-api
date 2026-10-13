import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { stageOutboxEvent } from "../../../infrastructure/queue/outbox";
import { generateUuidV7 } from "../../../shared/utils/uuidv7";
import { NotFoundError } from "../../../shared/errors/problem-details";
import { invalidateCache } from "../../../infrastructure/redis/cache";

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
}
