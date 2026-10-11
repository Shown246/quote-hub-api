import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchRepository, RawSearchRow } from "../../../../src/modules/search/repositories/search.repository";
import { prisma } from "../../../../src/infrastructure/database/prisma";

describe("SearchRepository", () => {
  let repo: SearchRepository;

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = new SearchRepository();
  });

  it("should return empty array for empty or whitespace query without executing SQL", async () => {
    const queryRawSpy = vi.spyOn(prisma, "$queryRaw");

    const res1 = await repo.searchTrigram("");
    const res2 = await repo.searchTrigram("    ");

    expect(res1).toEqual([]);
    expect(res2).toEqual([]);
    expect(queryRawSpy).not.toHaveBeenCalled();
  });

  it("should execute parameterized pg_trgm query and map raw rows into SearchResult models", async () => {
    const mockRows: RawSearchRow[] = [
      {
        id: "quote-1",
        text: "Simplicity is prerequisite for reliability.",
        author_name: "Edsger W. Dijkstra",
        is_original: false,
        like_count: BigInt(42),
        repost_count: BigInt(12),
        created_at: new Date("2026-10-01T10:00:00.000Z"),
        user_id: "user-1",
        username: "dijkstra_enthusiast",
        display_name: "E. Dijkstra Fan",
        avatar_url: "https://example.com/avatar.webp",
        theme_key: "academic-mono",
        rank_score: 0.852,
      },
    ];

    const queryRawSpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRows as any);

    const results = await repo.searchTrigram("dijkstr", 10);

    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    const sqlArg = queryRawSpy.mock.calls[0][0] as any;

    // Check that query parameters are properly passed to Prisma.sql
    expect(sqlArg.values).toContain("dijkstr");
    expect(sqlArg.values).toContain(10);

    // Verify raw SQL text contains soft-delete filter and pg_trgm expressions
    const sqlText = sqlArg.strings.join(" ");
    expect(sqlText).toContain("q.deleted_at IS NULL");
    expect(sqlText).toContain("similarity");
    expect(sqlText).toContain("q.text %");
    expect(sqlText).toContain("q.author_name %");
    expect(sqlText).toContain("u.username %");
    expect(sqlText).toContain("u.display_name %");
    expect(sqlText).toContain("ORDER BY rank_score DESC, q.created_at DESC");

    // Verify mapped SearchResult
    expect(results).toHaveLength(1);
    const item = results[0];
    expect(item.id).toBe("quote-1");
    expect(item.text).toBe("Simplicity is prerequisite for reliability.");
    expect(item.isOriginal).toBe(false);
    expect(item.authorName).toBe("Edsger W. Dijkstra");
    expect(item.likeCount).toBe(42);
    expect(item.repostCount).toBe(12);
    expect(item.rankScore).toBe(0.852);
    expect(item.createdAt).toEqual(new Date("2026-10-01T10:00:00.000Z"));
    expect(item.author).toEqual({
      id: "user-1",
      username: "dijkstra_enthusiast",
      displayName: "E. Dijkstra Fan",
      avatarUrl: "https://example.com/avatar.webp",
      profileImageUrl: "https://example.com/avatar.webp",
    });
    expect(item.username).toBe("dijkstra_enthusiast");
    expect(item.displayName).toBe("E. Dijkstra Fan");
    expect(item.themeKey).toBe("academic-mono");
  });

  it("should handle string ISO timestamps and null author / avatar correctly", async () => {
    const mockRows: RawSearchRow[] = [
      {
        id: "quote-2",
        text: "Original quote from user.",
        author_name: null,
        is_original: true,
        like_count: 0,
        repost_count: 0,
        created_at: "2026-10-05T15:30:00.000Z",
        user_id: "user-2",
        username: "original_author",
        display_name: "Original Author",
        profile_image_url: null,
        avatar_url: null,
        theme_key: null,
        rank_score: "0.45",
      },
    ];

    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRows as any);

    const results = await repo.searchTrigram("original", 20);

    expect(results).toHaveLength(1);
    const item = results[0];
    expect(item.authorName).toBeNull();
    expect(item.isOriginal).toBe(true);
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.createdAt.toISOString()).toBe("2026-10-05T15:30:00.000Z");
    expect(item.rankScore).toBe(0.45);
    expect(item.author.avatarUrl).toBeNull();
    expect(item.author.profileImageUrl).toBeNull();
    expect(item.themeKey).toBeNull();
  });

  it("should clamp limit to between 1 and 50", async () => {
    const queryRawSpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue([]);

    await repo.searchTrigram("query", 100);
    let sqlArg = queryRawSpy.mock.calls[0][0] as any;
    expect(sqlArg.values).toContain(50);

    await repo.searchTrigram("query", -10);
    sqlArg = queryRawSpy.mock.calls[1][0] as any;
    expect(sqlArg.values).toContain(1);
  });
});
