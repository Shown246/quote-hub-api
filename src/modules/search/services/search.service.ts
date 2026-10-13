import crypto from "crypto";
import {
  SearchResult,
  SearchRepository,
  searchRepository,
} from "../repositories/search.repository";
import { getOrSetCache } from "../../../infrastructure/redis/cache";

export { SearchResult };

export class SearchService {
  constructor(
    private readonly searchRepo: SearchRepository = searchRepository
  ) {}

  /**
   * Searches quotes, external authors, and user handles using PostgreSQL pg_trgm fuzzy matching.
   * Caches ranked search results in Redis for 60 seconds by query hash and limit.
   *
   * @param query The search query string
   * @param limit Maximum results to return (clamped between 1 and 50, default 20)
   * @returns Ranked SearchResult list
   */
  async search(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!query || typeof query !== "string") {
      return [];
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }

    const sanitizedQuery = trimmed.slice(0, 280);

    const parsedLimit = Number(limit);
    const safeLimit =
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.max(1, Math.min(parsedLimit, 50))
        : 20;

    const queryHash = crypto
      .createHash("sha256")
      .update(sanitizedQuery.toLowerCase())
      .digest("hex")
      .slice(0, 16);

    const cacheKey = `cache:search:${queryHash}:${safeLimit}`;

    const results = await getOrSetCache(cacheKey, 60, async () => {
      return this.searchRepo.searchTrigram(sanitizedQuery, safeLimit);
    });

    if (Array.isArray(results)) {
      return results.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt),
      }));
    }

    return results;
  }
}

export const searchService = new SearchService();
