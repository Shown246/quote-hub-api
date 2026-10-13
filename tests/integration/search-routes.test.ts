import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { prisma } from "../../src/infrastructure/database/prisma";
import { searchService } from "../../src/modules/search/services/search.service";
import { invalidateByPattern } from "../../src/infrastructure/redis/cache";

describe("Search Routes Integration (GET /api/v1/search)", () => {
  const app = createApp();

  beforeEach(async () => {
    vi.restoreAllMocks();
    await invalidateByPattern("cache:search:*");
  });

  it("should return 200 with empty data array when query parameter q is omitted", async () => {
    const querySpy = vi.spyOn(prisma, "$queryRaw");

    const res = await request(app).get("/api/v1/search");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("should return 200 with empty data array when query parameter q is whitespace-only", async () => {
    const querySpy = vi.spyOn(prisma, "$queryRaw");

    const res = await request(app).get("/api/v1/search?q=%20%20%20");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("should return 200 with typo-tolerant search results and rank scores", async () => {
    const mockRawRows = [
      {
        id: "01925b6a-9321-789a-b456-000000000001",
        text: "Simplicity is prerequisite for reliability.",
        author_name: "Edsger W. Dijkstra",
        is_original: false,
        like_count: 50,
        repost_count: 14,
        created_at: new Date("2026-10-07T12:00:00.000Z"),
        user_id: "01925b6a-9321-789a-b456-user00000001",
        username: "dijkstra_enthusiast",
        display_name: "E. Dijkstra",
        avatar_url: "https://example.com/avatar.webp",
        theme_key: "academic-dark",
        rank_score: 0.78,
      },
    ];

    const querySpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRawRows as any);

    // Minor typo "dijkstr" for "Dijkstra"
    const res = await request(app).get("/api/v1/search?q=dijkstr&limit=10");

    expect(res.status).toBe(200);
    expect(querySpy).toHaveBeenCalledTimes(1);

    // Verify raw query verifies soft delete exclusion and pg_trgm similarity
    const sqlArg = querySpy.mock.calls[0][0] as any;
    const sqlText = sqlArg.strings.join(" ");
    expect(sqlText).toContain("q.deleted_at IS NULL");
    expect(sqlText).toContain("similarity");
    expect(sqlArg.values).toContain("dijkstr");
    expect(sqlArg.values).toContain(10);

    // Verify response structure
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toHaveLength(1);
    const item = res.body.data[0];
    expect(item.id).toBe("01925b6a-9321-789a-b456-000000000001");
    expect(item.text).toBe("Simplicity is prerequisite for reliability.");
    expect(item.authorName).toBe("Edsger W. Dijkstra");
    expect(item.rankScore).toBe(0.78);
    expect(item.author).toEqual({
      id: "01925b6a-9321-789a-b456-user00000001",
      username: "dijkstra_enthusiast",
      displayName: "E. Dijkstra",
      avatarUrl: "https://example.com/avatar.webp",
      profileImageUrl: "https://example.com/avatar.webp",
    });
    expect(item.username).toBe("dijkstra_enthusiast");
    expect(item.displayName).toBe("E. Dijkstra");
  });

  it("should clamp limit to max 50 when client requests larger limit", async () => {
    const querySpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([]);

    const res = await request(app).get("/api/v1/search?q=test&limit=100");

    expect(res.status).toBe(200);
    expect(querySpy).toHaveBeenCalledTimes(1);
    const sqlArg = querySpy.mock.calls[0][0] as any;
    expect(sqlArg.values).toContain(50);
  });

  it("should return RFC 9457 error when service throws unexpected error", async () => {
    vi.spyOn(searchService, "search").mockRejectedValueOnce(new Error("Database disconnected"));

    const res = await request(app).get("/api/v1/search?q=error-test");

    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body).toHaveProperty("title");
    expect(res.body).toHaveProperty("status", 500);
  });
});
