import {
  SearchResult,
  SearchRepository,
  searchRepository,
} from "../repositories/search.repository";

export { SearchResult };

export class SearchService {
  constructor(
    private readonly searchRepo: SearchRepository = searchRepository
  ) {}

  /**
   * Searches quotes, external authors, and user handles using PostgreSQL pg_trgm fuzzy matching.
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

    return this.searchRepo.searchTrigram(sanitizedQuery, safeLimit);
  }
}

export const searchService = new SearchService();
