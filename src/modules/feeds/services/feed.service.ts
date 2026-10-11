import { PrismaClient, Quote } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import {
  FollowingFeedRepository,
  IFollowingFeedRepository,
} from "../repositories/following-feed.repository";
import {
  TrendingService,
  trendingService,
} from "../../trending/services/trending.service";
import { encodeCursor, decodeCursor } from "../../../shared/utils/cursor";
import { ValidationError } from "../../../shared/errors/problem-details";
import { FeedItem, FeedResponse } from "../types/feed.types";

type QuoteWithRelations = Quote & {
  user: {
    id: string;
    username: string;
    displayName: string;
    profileImageUrl?: string | null;
    avatarUrl?: string | null;
  };
  theme?: {
    key: string;
  } | null;
};

export class FeedService {
  constructor(
    private readonly followingRepo: IFollowingFeedRepository = new FollowingFeedRepository(),
    private readonly trendingServiceInstance: TrendingService = trendingService,
    private readonly db: PrismaClient = prisma
  ) {}

  /**
   * Retrieves the following feed for an authenticated user.
   * Delegates to FollowingFeedRepository with composite cursor pagination.
   *
   * @param userId The ID of the authenticated user
   * @param cursor Optional base64url cursor
   * @param limit Maximum number of items (default: 20)
   */
  async getFollowingFeed(
    userId: string,
    cursor?: string,
    limit?: number
  ): Promise<FeedResponse> {
    return this.followingRepo.getFollowingFeed(userId, cursor, limit);
  }

  /**
   * Retrieves the algorithmic For You feed.
   * Blends trending quotes with chronological quotes from PostgreSQL.
   * Initial request loads trending quotes with backfill for low-volume states.
   * Subsequent requests paginate chronologically via composite cursor.
   *
   * @param userId Optional authenticated user ID
   * @param cursor Optional base64url cursor
   * @param limit Maximum number of items (default: 20, max: 50)
   */
  async getForYouFeed(
    userId?: string,
    cursor?: string,
    limit: number = 20
  ): Promise<FeedResponse> {
    const safeLimit = Math.max(
      1,
      Math.min(Number.isFinite(limit) ? Math.floor(limit) : 20, 50)
    );

    // Paginated request: decode cursor and query chronologically
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        throw new ValidationError("Invalid pagination cursor");
      }

      const rows = await this.db.quote.findMany({
        where: {
          deletedAt: null,
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        },
        include: {
          user: true,
          theme: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: safeLimit + 1,
      });

      const hasMore = rows.length > safeLimit;
      const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
      const items: FeedItem[] = pageRows.map((q) =>
        this.mapQuoteToFeedItem(q as unknown as QuoteWithRelations)
      );

      let nextCursor: string | null = null;
      if (hasMore && pageRows.length > 0) {
        const last = pageRows[pageRows.length - 1];
        nextCursor = encodeCursor(last.createdAt, last.id);
      }

      return {
        items,
        nextCursor,
        hasMore,
      };
    }

    // Initial request (no cursor): fetch trending quotes
    const rawTrending = await this.trendingServiceInstance.getTrendingQuotes(
      safeLimit
    );
    const activeTrending = rawTrending.filter((q) => q.deletedAt === null);

    let hydratedTrending: QuoteWithRelations[] = [];
    if (activeTrending.length > 0) {
      const allHaveRelations = activeTrending.every(
        (q: any) => q.user && q.theme !== undefined
      );

      if (allHaveRelations) {
        hydratedTrending = activeTrending as unknown as QuoteWithRelations[];
      } else {
        const ids = activeTrending.map((q) => q.id);
        const dbQuotes = await this.db.quote.findMany({
          where: {
            id: { in: ids },
            deletedAt: null,
          },
          include: {
            user: true,
            theme: true,
          },
        });
        const map = new Map(dbQuotes.map((q) => [q.id, q]));
        hydratedTrending = ids
          .map((id) => map.get(id))
          .filter((q): q is any => q !== undefined) as unknown as QuoteWithRelations[];
      }
    }

    const cappedTrending = hydratedTrending.slice(0, safeLimit);
    const needed = Math.max(0, safeLimit - cappedTrending.length);
    const trendingIds = cappedTrending.map((q) => q.id);

    let pagedBackfill: QuoteWithRelations[] = [];
    let hasMore = false;

    if (needed === 0) {
      // Minor optimization: when limit is satisfied, perform lightweight existence check for hasMore
      const nextQuote = await this.db.quote.findFirst({
        where: {
          deletedAt: null,
          ...(trendingIds.length > 0 ? { id: { notIn: trendingIds } } : {}),
        },
        select: { id: true },
      });
      hasMore = Boolean(nextQuote);
    } else {
      // Backfill with recent quotes if trending quotes are fewer than limit
      const backfillQuotes = await this.db.quote.findMany({
        where: {
          deletedAt: null,
          ...(trendingIds.length > 0 ? { id: { notIn: trendingIds } } : {}),
        },
        include: {
          user: true,
          theme: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: needed + 1,
      });

      hasMore = backfillQuotes.length > needed;
      pagedBackfill = (
        hasMore ? backfillQuotes.slice(0, needed) : backfillQuotes
      ) as unknown as QuoteWithRelations[];
    }

    const combinedQuotes = [
      ...cappedTrending,
      ...pagedBackfill,
    ];
    const items: FeedItem[] = combinedQuotes.map((q) =>
      this.mapQuoteToFeedItem(q)
    );

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = combinedQuotes[combinedQuotes.length - 1];
      nextCursor = encodeCursor(last.createdAt, last.id);
    }

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Maps a Prisma quote with author and theme relations into unified FeedItem format.
   */
  private mapQuoteToFeedItem(quote: QuoteWithRelations): FeedItem {
    const avatar = quote.user.avatarUrl ?? quote.user.profileImageUrl ?? null;
    const quoteCreatedAt =
      quote.createdAt instanceof Date
        ? quote.createdAt
        : new Date(quote.createdAt);

    return {
      type: "ORIGINAL_QUOTE",
      actor: {
        id: quote.user.id,
        username: quote.user.username,
        displayName: quote.user.displayName,
        avatarUrl: avatar,
        profileImageUrl: avatar,
      },
      quote: {
        id: quote.id,
        text: quote.text,
        isOriginal: quote.isOriginal,
        authorName: quote.authorName ?? null,
        likeCount: quote.likeCount,
        repostCount: quote.repostCount,
        createdAt: quoteCreatedAt,
        themeKey: quote.theme?.key,
        author: {
          id: quote.user.id,
          username: quote.user.username,
          displayName: quote.user.displayName,
          avatarUrl: avatar,
          profileImageUrl: avatar,
        },
      },
      createdAt: quoteCreatedAt,
    };
  }
}

export const feedService = new FeedService();
