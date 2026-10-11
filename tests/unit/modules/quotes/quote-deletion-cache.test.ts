import { describe, it, expect, vi } from "vitest";
import { QuoteService } from "../../../../src/modules/quotes/services/quote.service";
import { QuoteRepository } from "../../../../src/modules/quotes/repositories/quote.repository";
import { TRENDING_REDIS_KEY } from "../../../../src/modules/trending/services/trending.service";

describe("QuoteService.deleteQuote cache invalidation", () => {
  it("removes quote ID from Redis trending set on deletion", async () => {
    const quoteRepo = new QuoteRepository({} as any);
    const mockQuote = { id: "quote-del-1", userId: "user-1", deletedAt: null };
    vi.spyOn(quoteRepo, "findById").mockResolvedValueOnce(mockQuote as any);
    vi.spyOn(quoteRepo, "softDelete").mockResolvedValueOnce({ ...mockQuote, deletedAt: new Date() } as any);

    const mockZrem = vi.fn().mockResolvedValue(1);
    const mockSafeCall = vi.fn().mockImplementation(async (cb: any) => {
      const mockClient = { zrem: mockZrem };
      await cb(mockClient);
    });

    const service = new QuoteService(quoteRepo, {} as any, mockSafeCall);
    await service.deleteQuote("user-1", "quote-del-1");

    expect(mockSafeCall).toHaveBeenCalled();
    expect(mockZrem).toHaveBeenCalledWith(TRENDING_REDIS_KEY, "quote-del-1");
  });
});
