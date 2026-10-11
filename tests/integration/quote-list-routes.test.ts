import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { prisma } from "../../src/infrastructure/database/prisma";

describe("GET /api/v1/quotes", () => {
  const app = createApp();

  it("returns 200 with quote list and pagination envelope", async () => {
    vi.spyOn(prisma.quote, "findMany").mockResolvedValueOnce([
      {
        id: "018f3a2c-1234-7000-8000-000000000001",
        userId: "018f3a2c-1234-7000-8000-000000000002",
        text: "The unexamined life is not worth living.",
        isOriginal: false,
        authorName: "Socrates",
        themeId: "018f3a2c-1234-7000-8000-000000000003",
        likeCount: 5,
        repostCount: 2,
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
        updatedAt: new Date("2026-01-01T12:00:00.000Z"),
        deletedAt: null,
        user: { id: "018f3a2c-1234-7000-8000-000000000002", username: "philosopher", displayName: "Thinker", profileImageUrl: null },
        theme: { id: "018f3a2c-1234-7000-8000-000000000003", key: "classic-serif", name: "Classic" },
      },
    ] as any);

    const res = await request(app).get("/api/v1/quotes?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.hasMore).toBe(false);
  });
});
