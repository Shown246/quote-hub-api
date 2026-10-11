import { Request, Response, NextFunction } from "express";
import { SearchService, searchService } from "../services/search.service";

export class SearchController {
  constructor(
    private readonly searchServiceInstance: SearchService = searchService
  ) {}

  /**
   * Handles GET /api/v1/search.
   * Reads optional query string `q` (defaults to empty string),
   * parses optional limit (default: 20, max: 50),
   * executes fuzzy trigram search, and responds with `{ data: results }`.
   */
  search = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const rawLimit = req.query.limit;
      const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : 20;
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

      const results = await this.searchServiceInstance.search(q, limit);

      res.status(200).json({ data: results });
    } catch (error) {
      next(error);
    }
  };
}

export const searchController = new SearchController();
