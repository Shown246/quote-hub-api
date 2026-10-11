import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchController } from "../../../../src/modules/search/controllers/search.controller";
import { SearchService } from "../../../../src/modules/search/services/search.service";
import { Request, Response, NextFunction } from "express";

describe("SearchController", () => {
  let mockSearchService: { search: ReturnType<typeof vi.fn> };
  let controller: SearchController;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearchService = { search: vi.fn() };
    controller = new SearchController(mockSearchService as unknown as SearchService);

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it("should parse query and limit and return 200 with { data: results }", async () => {
    const mockResults = [
      {
        id: "quote-1",
        text: "Simplicity is prerequisite for reliability.",
        isOriginal: false,
        authorName: "Edsger W. Dijkstra",
        likeCount: 10,
        repostCount: 2,
        createdAt: new Date(),
        rankScore: 0.8,
        author: {
          id: "user-1",
          username: "tester",
          displayName: "Tester",
          avatarUrl: null,
          profileImageUrl: null,
        },
        username: "tester",
        displayName: "Tester",
        themeKey: null,
      },
    ];

    mockSearchService.search.mockResolvedValueOnce(mockResults);

    req = {
      query: {
        q: "dijkstra",
        limit: "15",
      },
    };

    await controller.search(req as Request, res as Response, next);

    expect(mockSearchService.search).toHaveBeenCalledWith("dijkstra", 15);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: mockResults });
    expect(next).not.toHaveBeenCalled();
  });

  it("should default q to empty string and limit to 20 when query parameters are absent", async () => {
    mockSearchService.search.mockResolvedValueOnce([]);

    req = {
      query: {},
    };

    await controller.search(req as Request, res as Response, next);

    expect(mockSearchService.search).toHaveBeenCalledWith("", 20);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [] });
  });

  it("should fallback to default limit 20 when limit is invalid or non-numeric", async () => {
    mockSearchService.search.mockResolvedValueOnce([]);

    req = {
      query: {
        q: "hello",
        limit: "invalid-number",
      },
    };

    await controller.search(req as Request, res as Response, next);

    expect(mockSearchService.search).toHaveBeenCalledWith("hello", 20);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("should forward errors to next middleware", async () => {
    const error = new Error("Database error");
    mockSearchService.search.mockRejectedValueOnce(error);

    req = {
      query: { q: "test" },
    };

    await controller.search(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
