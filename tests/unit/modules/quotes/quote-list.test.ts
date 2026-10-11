import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuoteService } from "../../../../src/modules/quotes/services/quote.service";
import { QuoteRepository } from "../../../../src/modules/quotes/repositories/quote.repository";

describe("QuoteService.listQuotes", () => {
  let quoteRepo: QuoteRepository;
  let quoteService: QuoteService;

  beforeEach(() => {
    quoteRepo = new QuoteRepository({} as any);
    quoteService = new QuoteService(quoteRepo, {} as any);
  });

  it("returns paginated quotes with nextCursor and hasMore", async () => {
    const mockQuotes = [
      { id: "quote-1", text: "Quote 1", createdAt: new Date("2026-01-02T00:00:00Z"), deletedAt: null },
      { id: "quote-2", text: "Quote 2", createdAt: new Date("2026-01-01T00:00:00Z"), deletedAt: null },
    ];
    vi.spyOn(quoteRepo, "findManyWithPagination").mockResolvedValueOnce({
      items: mockQuotes as any,
      hasMore: false,
      nextCursor: null,
    });

    const result = await quoteService.listQuotes({ limit: 20 });
    expect(result.data).toHaveLength(2);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.nextCursor).toBeNull();
  });
});
