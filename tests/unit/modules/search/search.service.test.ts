import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchService } from "../../../../src/modules/search/services/search.service";
import { SearchRepository, SearchResult } from "../../../../src/modules/search/repositories/search.repository";

describe("SearchService", () => {
  let mockRepo: { searchTrigram: ReturnType<typeof vi.fn> };
  let service: SearchService;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockRepo = { searchTrigram: vi.fn() };
    service = new SearchService(mockRepo as unknown as SearchRepository);
  });

  it("should return empty array for empty or whitespace query without hitting database", async () => {
    const results = await service.search("   ");
    expect(results).toEqual([]);
    expect(mockRepo.searchTrigram).not.toHaveBeenCalled();
  });

  it("should return empty array for empty string query without hitting database", async () => {
    const results = await service.search("");
    expect(results).toEqual([]);
    expect(mockRepo.searchTrigram).not.toHaveBeenCalled();
  });

  it("should return empty array for non-string query input", async () => {
    const results = await service.search(null as any);
    expect(results).toEqual([]);
    expect(mockRepo.searchTrigram).not.toHaveBeenCalled();

    const resultsUndefined = await service.search(undefined as any);
    expect(resultsUndefined).toEqual([]);
    expect(mockRepo.searchTrigram).not.toHaveBeenCalled();
  });

  it("should trim query and delegate to repository with default limit (20)", async () => {
    const mockResults: SearchResult[] = [
      {
        id: "quote-1",
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: false,
        authorName: "Edsger W. Dijkstra",
        likeCount: 15,
        repostCount: 4,
        createdAt: new Date("2026-10-01T00:00:00Z"),
        rankScore: 0.85,
        author: {
          id: "user-1",
          username: "dijkstra_fan",
          displayName: "Dijkstra Fan",
          avatarUrl: null,
          profileImageUrl: null,
        },
        username: "dijkstra_fan",
        displayName: "Dijkstra Fan",
        themeKey: "academic-light",
      },
    ];

    mockRepo.searchTrigram.mockResolvedValueOnce(mockResults);

    const results = await service.search("  dijkstr  ");

    expect(mockRepo.searchTrigram).toHaveBeenCalledTimes(1);
    expect(mockRepo.searchTrigram).toHaveBeenCalledWith("dijkstr", 20);
    expect(results).toEqual(mockResults);
  });

  it("should clamp limit to between 1 and 50", async () => {
    mockRepo.searchTrigram.mockResolvedValue([]);

    // Valid limit within bounds
    await service.search("algorithm", 10);
    expect(mockRepo.searchTrigram).toHaveBeenLastCalledWith("algorithm", 10);

    // Limit exceeding max (50) clamped to 50
    await service.search("algorithm", 100);
    expect(mockRepo.searchTrigram).toHaveBeenLastCalledWith("algorithm", 50);

    // Invalid non-positive limit falls back to default 20
    await service.search("algorithm", -5);
    expect(mockRepo.searchTrigram).toHaveBeenLastCalledWith("algorithm", 20);

    await service.search("algorithm", 0);
    expect(mockRepo.searchTrigram).toHaveBeenLastCalledWith("algorithm", 20);

    // Non-integer or NaN limit falls back to default 20
    await service.search("algorithm", NaN as any);
    expect(mockRepo.searchTrigram).toHaveBeenLastCalledWith("algorithm", 20);

    await service.search("algorithm", 15.5 as any);
    expect(mockRepo.searchTrigram).toHaveBeenLastCalledWith("algorithm", 20);
  });

  it("should sanitize and clamp queries longer than 280 characters to 280 before calling repository", async () => {
    mockRepo.searchTrigram.mockResolvedValue([]);

    const longQuery = "a".repeat(300);
    await service.search(longQuery);

    expect(mockRepo.searchTrigram).toHaveBeenCalledTimes(1);
    expect(mockRepo.searchTrigram).toHaveBeenCalledWith("a".repeat(280), 20);
  });
});
