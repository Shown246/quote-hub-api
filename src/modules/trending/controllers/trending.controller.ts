import { Request, Response, NextFunction } from "express";
import { TrendingService, trendingService } from "../services/trending.service";

export class TrendingController {
  constructor(
    private readonly trendingServiceInstance: TrendingService = trendingService
  ) {}

  /**
   * Handles GET /api/v1/trending.
   * Parses optional limit query parameter (default: 20, max: 50).
   * Returns JSON response with { data: quotes }.
   */
  getTrending = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const parsedLimit = req.query.limit ? Number(req.query.limit) : 20;
      let limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
      if (limit > 50) {
        limit = 50;
      }

      const quotes = await this.trendingServiceInstance.getTrendingQuotes(limit);
      res.status(200).json({ data: quotes });
    } catch (error) {
      next(error);
    }
  };
}

export const trendingController = new TrendingController();
