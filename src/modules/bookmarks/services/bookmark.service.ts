import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { NotFoundError } from "../../../shared/errors/problem-details";

export interface BookmarkListResult {
  data: any[];
  items: any[];
  nextCursor: string | null;
}

export class BookmarkService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Helper method to verify an active (non-soft-deleted) quote exists.
   * Returns the quote id or null if not found / soft-deleted.
   */
  protected async findActiveQuote(
    quoteId: string
  ): Promise<{ id: string } | null> {
    return this.db.quote.findFirst({
      where: {
        id: quoteId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
  }

  /**
   * Bookmarks a quote privately for the requesting user:
   * 1. Checks that the quote exists and is not soft-deleted (deletedAt === null).
   * 2. Idempotently returns if already bookmarked.
   * 3. Inserts into Bookmark table (composite PK [userId, quoteId]).
   * 4. Catches P2002 unique constraint violations idempotently.
   * Note: Bookmarks are strictly private; no outbox events or counter increments.
   */
  async bookmark(
    userId: string,
    quoteId: string
  ): Promise<{ bookmarked: boolean; quoteId: string }> {
    const quote = await this.findActiveQuote(quoteId);

    if (!quote) {
      throw new NotFoundError("Quote not found");
    }

    const existingBookmark = await this.db.bookmark.findUnique({
      where: {
        userId_quoteId: {
          userId,
          quoteId,
        },
      },
    });

    if (existingBookmark) {
      return { bookmarked: true, quoteId };
    }

    try {
      await this.db.bookmark.create({
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
        return { bookmarked: true, quoteId };
      }
      throw error;
    }

    return { bookmarked: true, quoteId };
  }

  /**
   * Removes a quote from user's bookmarks (hard delete).
   * Idempotently catches P2025 if the bookmark does not exist.
   */
  async unbookmark(
    userId: string,
    quoteId: string
  ): Promise<{ bookmarked: boolean; quoteId: string }> {
    try {
      await this.db.bookmark.delete({
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
        return { bookmarked: false, quoteId };
      }
      throw error;
    }

    return { bookmarked: false, quoteId };
  }

  /**
   * Lists bookmarks belonging strictly to the requesting user with cursor pagination.
   * Soft-deleted quotes are filtered out.
   */
  async listBookmarks(
    userId: string,
    cursor?: string,
    limit: number = 20
  ): Promise<BookmarkListResult> {
    return this.queryUserBookmarks(userId, cursor, limit);
  }

  /**
   * Protected helper to query bookmarks for a user with cursor pagination.
   */
  protected async queryUserBookmarks(
    userId: string,
    cursor?: string,
    limit: number = 20
  ): Promise<BookmarkListResult> {
    const take = Math.max(1, Math.min(limit, 100));

    try {
      const rawBookmarks = await this.db.bookmark.findMany({
        where: {
          userId,
          quote: {
            deletedAt: null,
          },
        },
        include: {
          quote: {
            include: {
              theme: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  profileImageUrl: true,
                },
              },
            },
          },
        },
        orderBy: [
          { createdAt: "desc" },
          { quoteId: "desc" },
        ],
        take: take + 1,
        ...(cursor
          ? {
              cursor: {
                userId_quoteId: {
                  userId,
                  quoteId: cursor,
                },
              },
              skip: 1,
            }
          : {}),
      });

      const hasMore = rawBookmarks.length > take;
      const data = hasMore ? rawBookmarks.slice(0, take) : rawBookmarks;
      const nextCursor =
        hasMore && data.length > 0 ? data[data.length - 1].quoteId : null;

      return {
        data,
        items: data,
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
