import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";

export interface SearchAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileImageUrl: string | null;
}

export interface SearchResult {
  id: string;
  text: string;
  isOriginal: boolean;
  authorName: string | null;
  likeCount: number;
  repostCount: number;
  createdAt: Date;
  rankScore: number;
  author: SearchAuthor;
  username: string;
  displayName: string;
  themeKey?: string | null;
}

export interface RawSearchRow {
  id: string;
  text: string;
  author_name: string | null;
  is_original: boolean;
  like_count: number | bigint;
  repost_count: number | bigint;
  created_at: Date | string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  profile_image_url?: string | null;
  theme_key?: string | null;
  rank_score: number | string;
}

export interface ISearchRepository {
  searchTrigram(query: string, limit?: number): Promise<SearchResult[]>;
}

/**
 * Repository executing pg_trgm fuzzy similarity search conforming to
 * Section 9.2 of the Database Design Document.
 */
export class SearchRepository implements ISearchRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Executes a parameterized pg_trgm similarity search across quote content,
   * external author attribution, and user handles.
   *
   * @param query The search query string
   * @param limit Maximum number of ranked results to return (default 20, max 50)
   * @returns Array of SearchResult items ranked by similarity score descending
   */
  async searchTrigram(query: string, limit: number = 20): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const safeLimit = Math.max(
      1,
      Math.min(Number.isFinite(limit) ? Math.floor(limit) : 20, 50)
    );

    const sqlQuery = Prisma.sql`
      SELECT 
        q.id,
        q.text,
        q.author_name,
        q.is_original,
        q.like_count,
        q.repost_count,
        q.created_at,
        u.id AS user_id,
        u.username,
        u.display_name,
        u.profile_image_url AS avatar_url,
        t.key AS theme_key,
        GREATEST(
          similarity(q.text, ${trimmed}),
          similarity(COALESCE(q.author_name, ''), ${trimmed}),
          similarity(u.username, ${trimmed}),
          similarity(u.display_name, ${trimmed})
        ) AS rank_score
      FROM quotes q
      JOIN users u ON q.user_id = u.id
      LEFT JOIN themes t ON q.theme_id = t.id
      WHERE q.deleted_at IS NULL
        AND (
          q.text % ${trimmed}
          OR (q.author_name IS NOT NULL AND q.author_name % ${trimmed})
          OR u.username % ${trimmed}
          OR u.display_name % ${trimmed}
        )
      ORDER BY rank_score DESC, q.created_at DESC
      LIMIT ${safeLimit};
    `;

    const rows = await this.db.$queryRaw<RawSearchRow[]>(sqlQuery);

    return rows.map((row) => this.mapRowToSearchResult(row));
  }

  /**
   * Maps a raw SQL database row into the strongly typed SearchResult model.
   */
  private mapRowToSearchResult(row: RawSearchRow): SearchResult {
    const createdAt =
      row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at);
    const avatar = row.avatar_url ?? row.profile_image_url ?? null;

    return {
      id: row.id,
      text: row.text,
      isOriginal: Boolean(row.is_original),
      authorName: row.author_name ?? null,
      likeCount: Number(row.like_count ?? 0),
      repostCount: Number(row.repost_count ?? 0),
      createdAt,
      rankScore: Number(row.rank_score ?? 0),
      author: {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: avatar,
        profileImageUrl: avatar,
      },
      username: row.username,
      displayName: row.display_name,
      themeKey: row.theme_key ?? null,
    };
  }
}

export const searchRepository = new SearchRepository();
