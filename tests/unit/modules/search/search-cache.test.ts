import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { SearchService } from "../../../../src/modules/search/services/search.service";
import { redis } from "../../../../src/infrastructure/redis/redis";

describe("Search Hot Path Caching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleResults = [
    {
      id: "quote-1",
      type: "QUOTE",
      title: "Clean code",
      snippet: "Clean code always looks like it was written by someone who cares.",
      score: 0.95,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];

  it("should return cached results on cache hit without database query", async () => {
    const mockRepo = {
      searchTrigram: vi.fn(),
    } as any;
    const service = new SearchService(mockRepo);

    const query = "Clean code";
    const queryHash = crypto
      .createHash("sha256")
      .update(query.toLowerCase())
      .digest("hex")
      .slice(0, 16);
    const expectedKey = `cache:search:${queryHash}:20`;

    vi.spyOn(redis, "get").mockResolvedValueOnce(JSON.stringify(sampleResults));

    const results = await service.search(query, 20);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("quote-1");
    expect(redis.get).toHaveBeenCalledWith(expectedKey);
    expect(mockRepo.searchTrigram).not.toHaveBeenCalled();
  });

  it("should query trigram search and cache results with 60s TTL on cache miss", async () => {
    const mockRepo = {
      searchTrigram: vi.fn().mockResolvedValueOnce(sampleResults),
    } as any;
    const service = new SearchService(mockRepo);

    const query = "Clean code";
    const queryHash = crypto
      .createHash("sha256")
      .update(query.toLowerCase())
      .digest("hex")
      .slice(0, 16);
    const expectedKey = `cache:search:${queryHash}:20`;

    vi.spyOn(redis, "get").mockResolvedValueOnce(null);
    const setSpy = vi.spyOn(redis, "set").mockResolvedValueOnce("OK" as any);

    const results = await service.search(query, 20);

    expect(results).toHaveLength(1);
    expect(mockRepo.searchTrigram).toHaveBeenCalledWith(query, 20);
    expect(setSpy).toHaveBeenCalledWith(
      expectedKey,
      expect.any(String),
      "EX",
      60
    );
  });
});
