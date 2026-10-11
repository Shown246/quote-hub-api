import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { encodeCursor, decodeCursor } from "../../../shared/utils/cursor";
import {
  FeedCandidateRawRow,
  FeedItem,
  FollowingFeedResult,
} from "../types/feed.types";

export interface IFollowingFeedRepository {
  getFollowingFeed(
    userId: string,
    cursor?: string,
    limit?: number
  ): Promise<FollowingFeedResult>;
}

/**
 * Repository responsible for executing the chronological Following Feed query
 * defined in Section 9.1 of the Database Design Document.
 *
 * Merges original quotes and reposts created by followed users, excluding soft-deleted
 * quotes, and returns unified FeedItem instances with composite cursor pagination.
 */
export class FollowingFeedRepository implements IFollowingFeedRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Retrieves the following feed for a user using raw SQL composite cursor pagination.
   *
   * @param userId The ID of the follower requesting the feed.
   * @param cursor Optional opaque base64url pagination cursor.
   * @param limit The number of items to return (default: 20, max: 100).
   * @returns Paginated FeedItem models, nextCursor, and hasMore flag.
   */
  async getFollowingFeed(
    userId: string,
    cursor?: string,
    limit: number = 20
  ): Promise<FollowingFeedResult> {
    const safeLimit = Math.max(
      1,
      Math.min(Number.isFinite(limit) ? Math.floor(limit) : 20, 100)
    );
    const fetchLimit = safeLimit + 1;

    let cursorCondition = Prisma.empty;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        cursorCondition = Prisma.sql`AND (fc.event_time, fc.tiebreaker_id) < (${decoded.createdAt}, ${decoded.id}::uuid)`;
      }
    }

    const query = Prisma.sql`
      WITH user_following AS (
        -- Resolve target users followed by current user
        SELECT following_id 
        FROM follows 
        WHERE follower_id = ${userId}::uuid
      ),
      feed_candidates AS (
        -- 1. Original quotes posted by followed users
        SELECT 
          q.id AS quote_id,
          q.user_id AS poster_id,
          'ORIGINAL_QUOTE' AS feed_item_type,
          q.user_id AS actor_id,
          q.created_at AS event_time,
          q.id AS tiebreaker_id
        FROM quotes q
        JOIN user_following uf ON q.user_id = uf.following_id
        WHERE q.deleted_at IS NULL

        UNION ALL

        -- 2. Quotes reposted by followed users
        SELECT 
          r.quote_id AS quote_id,
          q.user_id AS poster_id,
          'REPOST' AS feed_item_type,
          r.user_id AS actor_id,
          r.created_at AS event_time,
          r.id AS tiebreaker_id
        FROM reposts r
        JOIN user_following uf ON r.user_id = uf.following_id
        JOIN quotes q ON r.quote_id = q.id
        WHERE q.deleted_at IS NULL
      )
      SELECT 
        fc.feed_item_type,
        fc.actor_id,
        fc.event_time,
        fc.tiebreaker_id,
        q.id AS quote_id,
        q.id,
        q.text,
        q.is_original,
        q.author_name,
        q.like_count,
        q.repost_count,
        q.created_at,
        u.id AS author_id,
        u.username AS author_username,
        u.display_name AS author_display_name,
        u.profile_image_url AS author_avatar_url,
        act.username AS actor_username,
        act.display_name AS actor_display_name,
        act.profile_image_url AS actor_avatar_url,
        t.key AS theme_key
      FROM feed_candidates fc
      JOIN quotes q ON fc.quote_id = q.id
      JOIN users u ON q.user_id = u.id
      JOIN users act ON fc.actor_id = act.id
      JOIN themes t ON q.theme_id = t.id
      WHERE 1=1
        ${cursorCondition}
      ORDER BY fc.event_time DESC, fc.tiebreaker_id DESC
      LIMIT ${fetchLimit};
    `;

    const rows = await this.db.$queryRaw<FeedCandidateRawRow[]>(query);

    const hasMore = rows.length > safeLimit;
    const pagedRows = hasMore ? rows.slice(0, safeLimit) : rows;

    const items: FeedItem[] = pagedRows.map((row) =>
      this.mapRowToFeedItem(row)
    );

    let nextCursor: string | null = null;
    if (hasMore && pagedRows.length > 0) {
      const lastRow = pagedRows[pagedRows.length - 1];
      const lastTime =
        lastRow.event_time instanceof Date
          ? lastRow.event_time
          : new Date(lastRow.event_time);
      const tiebreakerId =
        lastRow.tiebreaker_id || lastRow.quote_id || lastRow.id || "";
      nextCursor = encodeCursor(lastTime, tiebreakerId);
    }

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Maps a raw SQL candidate row into the unified FeedItem model.
   */
  private mapRowToFeedItem(row: FeedCandidateRawRow): FeedItem {
    const isOriginal = row.feed_item_type === "ORIGINAL_QUOTE";
    const quoteCreatedAt =
      row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at);
    const eventTime =
      row.event_time instanceof Date
        ? row.event_time
        : new Date(row.event_time);

    const authorAvatar = row.author_avatar_url ?? null;
    const actorAvatar =
      row.actor_avatar_url ?? (isOriginal ? authorAvatar : null);

    return {
      type: row.feed_item_type,
      actor: {
        id: row.actor_id,
        username:
          row.actor_username ?? (isOriginal ? row.author_username : ""),
        displayName:
          row.actor_display_name ??
          (isOriginal ? row.author_display_name : ""),
        avatarUrl: actorAvatar,
        profileImageUrl: actorAvatar,
      },
      quote: {
        id: row.quote_id ?? row.id ?? "",
        text: row.text,
        isOriginal: Boolean(row.is_original),
        authorName: row.author_name ?? null,
        likeCount: Number(row.like_count ?? 0),
        repostCount: Number(row.repost_count ?? 0),
        createdAt: quoteCreatedAt,
        themeKey: row.theme_key ?? undefined,
        author: {
          id: row.author_id,
          username: row.author_username,
          displayName: row.author_display_name,
          avatarUrl: authorAvatar,
          profileImageUrl: authorAvatar,
        },
      },
      createdAt: eventTime,
    };
  }
}
