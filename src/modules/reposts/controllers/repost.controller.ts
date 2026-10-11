import { Request, Response, NextFunction } from "express";
import { RepostService } from "../services/repost.service";
import { AuthenticationError } from "../../../shared/errors/problem-details";

export class RepostController {
  constructor(
    private readonly repostService: RepostService = new RepostService()
  ) {}

  /**
   * Handles quote repost request (POST /quotes/:quoteId/repost).
   * Requires authenticated user. Returns 200 with { reposted: true, quoteId }.
   */
  repostQuote = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const { quoteId } = req.params;
      const result = await this.repostService.repostQuote(req.user.id, quoteId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles quote unrepost request (DELETE /quotes/:quoteId/repost).
   * Requires authenticated user. Returns 200 with { reposted: false, quoteId }.
   */
  unrepostQuote = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const { quoteId } = req.params;
      const result = await this.repostService.unrepostQuote(
        req.user.id,
        quoteId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const repostController = new RepostController();
