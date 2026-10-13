import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { stageOutboxEvent } from "../../../infrastructure/queue/outbox";
import {
  NotFoundError,
  ValidationError,
} from "../../../shared/errors/problem-details";
import { invalidateCache } from "../../../infrastructure/redis/cache";

export class LikeService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Helper method to retrieve the quote's owner ID within a transaction boundary.
   * Throws NotFoundError if quote does not exist or has been soft-deleted.
   */
  protected async getQuoteOwner(
    quoteId: string,
    tx?: Prisma.TransactionClient
  ): Promise<string> {
    const client = tx ?? this.db;
    const quote = await client.quote.findFirst({
      where: {
        id: quoteId,
        deletedAt: null,
      },
      select: {
        userId: true,
      },
    });

    if (!quote) {
      throw new NotFoundError("Quote not found");
    }

    return quote.userId;
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
   * Likes a quote atomically:
   * 1. Validates quote exists and is not soft-deleted.
   * 2. Guards against self-likes (userId !== quote.userId).
   * 3. Idempotently returns if already liked without double-incrementing.
   * 4. Inserts Like record, catching P2002 unique constraint race conditions idempotently.
   * 5. Atomically increments like_count on quotes table.
   * 6. Stages LikeCreated Transactional Outbox event.
   */
  async likeQuote(
    userId: string,
    quoteId: string
  ): Promise<{ liked: boolean; quoteId: string }> {
    try {
      const result = await this.runTransaction(async (tx) => {
        const quoteOwner = await this.getQuoteOwner(quoteId, tx);

        if (quoteOwner === userId) {
          const error = new ValidationError("Users cannot like their own quote");
          (error as any).code = "CANNOT_LIKE_OWN_QUOTE";
          throw error;
        }

        const existingLike = await tx.like.findUnique({
          where: {
            userId_quoteId: {
              userId,
              quoteId,
            },
          },
        });

        if (existingLike) {
          return { liked: true, quoteId };
        }

        try {
          await tx.like.create({
            data: {
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
            return { liked: true, quoteId };
          }
          throw error;
        }

        await tx.$executeRaw`UPDATE quotes SET like_count = like_count + 1 WHERE id = ${quoteId}::uuid`;

        await stageOutboxEvent(tx, "LikeCreated", "Quote", quoteId, {
          actorId: userId,
          quoteId,
          recipientId: quoteOwner,
        });

        return { liked: true, quoteId };
      });

      await invalidateCache(`cache:quote:${quoteId}`);
      return result;
    } catch (error: any) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002") ||
        error?.code === "P2002"
      ) {
        return { liked: true, quoteId };
      }
      throw error;
    }
  }

  /**
   * Unlikes a quote atomically:
   * 1. Validates quote exists and is not soft-deleted.
   * 2. Idempotently returns if like did not exist without counter decrement.
   * 3. Physically deletes Like record.
   * 4. Decrements like_count safely with GREATEST(like_count - 1, 0).
   * 5. Stages LikeRemoved Transactional Outbox event.
   */
  async unlikeQuote(
    userId: string,
    quoteId: string
  ): Promise<{ liked: boolean; quoteId: string }> {
    try {
      const result = await this.runTransaction(async (tx) => {
        await this.getQuoteOwner(quoteId, tx);

        const existingLike = await tx.like.findUnique({
          where: {
            userId_quoteId: {
              userId,
              quoteId,
            },
          },
        });

        if (!existingLike) {
          return { liked: false, quoteId };
        }

        try {
          await tx.like.delete({
            where: {
              userId_quoteId: {
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
            return { liked: false, quoteId };
          }
          throw error;
        }

        await tx.$executeRaw`UPDATE quotes SET like_count = GREATEST(like_count - 1, 0) WHERE id = ${quoteId}::uuid`;

        await stageOutboxEvent(tx, "LikeRemoved", "Quote", quoteId, {
          actorId: userId,
          quoteId,
        });

        return { liked: false, quoteId };
      });

      await invalidateCache(`cache:quote:${quoteId}`);
      return result;
    } catch (error: any) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2025") ||
        error?.code === "P2025"
      ) {
        return { liked: false, quoteId };
      }
      throw error;
    }
  }
}
