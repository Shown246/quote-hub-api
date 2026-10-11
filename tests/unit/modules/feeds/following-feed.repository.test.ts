import { describe, it, expect, vi, beforeEach } from "vitest";
import { FollowingFeedRepository } from "../../../../src/modules/feeds/repositories/following-feed.repository";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import { encodeCursor } from "../../../../src/shared/utils/cursor";

describe("FollowingFeedRepository", () => {
  let repo: FollowingFeedRepository;

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = new FollowingFeedRepository();
  });

  it("should format raw SQL feed candidates into unified FeedItem models", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([
      {
        feed_item_type: "ORIGINAL_QUOTE",
        actor_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        event_time: new Date("2026-10-07T12:00:00Z"),
        quote_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        tiebreaker_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        text: "Clean code is simple.",
        is_original: true,
        author_name: null,
        like_count: 5,
        repost_count: 2,
        created_at: new Date("2026-10-07T12:00:00Z"),
        author_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        author_username: "linus",
        author_display_name: "Linus T",
        author_avatar_url: null,
        theme_key: "modern-dark",
      },
    ] as any);

    const result = await repo.getFollowingFeed("follower-user", undefined, 10);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("ORIGINAL_QUOTE");
    expect(result.items[0].quote.text).toBe("Clean code is simple.");
    expect(result.items[0].actor.id).toBe("018f972b-5b3a-7d4e-8fa1-000000000001");
    expect(result.items[0].actor.username).toBe("linus");
    expect(result.items[0].quote.author.username).toBe("linus");
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("should correctly map reposts with reposter as actor and quote author as author", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([
      {
        feed_item_type: "REPOST",
        actor_id: "018f972b-5b3a-7d4e-8fa1-000000000002",
        actor_username: "alice",
        actor_display_name: "Alice Smith",
        actor_avatar_url: "https://example.com/alice.png",
        event_time: new Date("2026-10-07T14:30:00Z"),
        quote_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        tiebreaker_id: "018f972b-5b3a-7d4e-8fa1-000000000099",
        text: "Clean code is simple.",
        is_original: true,
        author_name: null,
        like_count: 5,
        repost_count: 3,
        created_at: new Date("2026-10-07T12:00:00Z"),
        author_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        author_username: "linus",
        author_display_name: "Linus T",
        author_avatar_url: null,
        theme_key: "modern-dark",
      },
    ] as any);

    const result = await repo.getFollowingFeed("follower-user", undefined, 10);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("REPOST");
    expect(result.items[0].actor.id).toBe("018f972b-5b3a-7d4e-8fa1-000000000002");
    expect(result.items[0].actor.username).toBe("alice");
    expect(result.items[0].actor.displayName).toBe("Alice Smith");
    expect(result.items[0].quote.author.id).toBe("018f972b-5b3a-7d4e-8fa1-000000000001");
    expect(result.items[0].quote.author.username).toBe("linus");
    expect(result.items[0].createdAt).toEqual(new Date("2026-10-07T14:30:00Z"));
    expect(result.items[0].quote.createdAt).toEqual(new Date("2026-10-07T12:00:00Z"));
  });

  it("should handle empty feed when user has no follows or candidates", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([]);

    const result = await repo.getFollowingFeed("follower-user", undefined, 10);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("should paginate with limit and set hasMore=true with valid nextCursor", async () => {
    const rawRows = [
      {
        feed_item_type: "ORIGINAL_QUOTE",
        actor_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        event_time: new Date("2026-10-07T13:00:00Z"),
        quote_id: "018f972b-5b3a-7d4e-8fa1-000000000011",
        tiebreaker_id: "018f972b-5b3a-7d4e-8fa1-000000000011",
        text: "Second quote",
        is_original: true,
        author_name: null,
        like_count: 0,
        repost_count: 0,
        created_at: new Date("2026-10-07T13:00:00Z"),
        author_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        author_username: "linus",
        author_display_name: "Linus T",
        author_avatar_url: null,
        theme_key: "modern-dark",
      },
      {
        feed_item_type: "ORIGINAL_QUOTE",
        actor_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        event_time: new Date("2026-10-07T12:00:00Z"),
        quote_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        tiebreaker_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        text: "First quote",
        is_original: true,
        author_name: null,
        like_count: 5,
        repost_count: 2,
        created_at: new Date("2026-10-07T12:00:00Z"),
        author_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        author_username: "linus",
        author_display_name: "Linus T",
        author_avatar_url: null,
        theme_key: "modern-dark",
      },
      // extra row indicating hasMore (limit = 2, so 3 rows returned)
      {
        feed_item_type: "ORIGINAL_QUOTE",
        actor_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        event_time: new Date("2026-10-07T11:00:00Z"),
        quote_id: "018f972b-5b3a-7d4e-8fa1-000000000009",
        tiebreaker_id: "018f972b-5b3a-7d4e-8fa1-000000000009",
        text: "Older quote",
        is_original: true,
        author_name: null,
        like_count: 1,
        repost_count: 0,
        created_at: new Date("2026-10-07T11:00:00Z"),
        author_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        author_username: "linus",
        author_display_name: "Linus T",
        author_avatar_url: null,
        theme_key: "modern-dark",
      },
    ];

    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(rawRows as any);

    const result = await repo.getFollowingFeed("follower-user", undefined, 2);
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();

    const expectedCursor = encodeCursor(
      rawRows[1].event_time,
      rawRows[1].tiebreaker_id
    );
    expect(result.nextCursor).toBe(expectedCursor);
  });

  it("should decode valid cursor and apply cursor condition", async () => {
    const queryRawSpy = vi
      .spyOn(prisma, "$queryRaw")
      .mockResolvedValueOnce([] as any);

    const cursorDate = new Date("2026-10-07T12:00:00.000Z");
    const cursorId = "018f972b-5b3a-7d4e-8fa1-000000000010";
    const cursor = encodeCursor(cursorDate, cursorId);

    await repo.getFollowingFeed("follower-user", cursor, 10);

    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    const sqlArg = queryRawSpy.mock.calls[0][0] as any;
    // Check that cursor values are included in parameterized SQL
    expect(sqlArg.values).toContainEqual(cursorDate);
    expect(sqlArg.values).toContainEqual(cursorId);
  });

  it("should handle invalid or malformed cursor gracefully without throwing", async () => {
    const queryRawSpy = vi
      .spyOn(prisma, "$queryRaw")
      .mockResolvedValueOnce([] as any);

    const result = await repo.getFollowingFeed(
      "follower-user",
      "invalid-base64-cursor",
      10
    );

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    const sqlArg = queryRawSpy.mock.calls[0][0] as any;
    expect(sqlArg.values).not.toContain("invalid-base64-cursor");
  });

  it("should sanitize limit and apply default when limit is invalid", async () => {
    const queryRawSpy = vi
      .spyOn(prisma, "$queryRaw")
      .mockResolvedValueOnce([] as any);

    await repo.getFollowingFeed("follower-user", undefined, -5);

    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    const sqlArg = queryRawSpy.mock.calls[0][0] as any;
    // When limit is -5, safeLimit is 1, fetchLimit is 2
    expect(sqlArg.values).toContainEqual(2);
  });

  it("should set hasMore=false and nextCursor=null when results exactly match limit", async () => {
    const rawRows = [
      {
        feed_item_type: "ORIGINAL_QUOTE",
        actor_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        event_time: new Date("2026-10-07T12:00:00Z"),
        quote_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        tiebreaker_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        text: "Clean code is simple.",
        is_original: true,
        author_name: null,
        like_count: 5,
        repost_count: 2,
        created_at: new Date("2026-10-07T12:00:00Z"),
        author_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        author_username: "linus",
        author_display_name: "Linus T",
        author_avatar_url: null,
        theme_key: "modern-dark",
      },
    ];

    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(rawRows as any);

    const result = await repo.getFollowingFeed("follower-user", undefined, 1);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("should correctly handle string ISO timestamps and BigInt count types from raw database drivers", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([
      {
        feed_item_type: "ORIGINAL_QUOTE",
        actor_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        event_time: "2026-10-07T12:00:00.000Z",
        quote_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        tiebreaker_id: "018f972b-5b3a-7d4e-8fa1-000000000010",
        text: "ISO string timestamp quote",
        is_original: false,
        author_name: "External Author",
        like_count: BigInt(42),
        repost_count: BigInt(7),
        created_at: "2026-10-07T12:00:00.000Z",
        author_id: "018f972b-5b3a-7d4e-8fa1-000000000001",
        author_username: "linus",
        author_display_name: "Linus T",
        author_avatar_url: null,
        theme_key: "cyberpunk",
      },
    ] as any);

    const result = await repo.getFollowingFeed("follower-user", undefined, 10);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quote.authorName).toBe("External Author");
    expect(result.items[0].quote.likeCount).toBe(42);
    expect(result.items[0].quote.repostCount).toBe(7);
    expect(result.items[0].quote.themeKey).toBe("cyberpunk");
    expect(result.items[0].createdAt).toBeInstanceOf(Date);
    expect(result.items[0].quote.createdAt).toBeInstanceOf(Date);
  });
});
