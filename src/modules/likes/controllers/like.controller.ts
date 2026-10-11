import { Request, Response, NextFunction } from "express";
import { LikeService } from "../services/like.service";
import { AuthenticationError } from "../../../shared/errors/problem-details";

export class LikeController {
  constructor(private readonly likeService: LikeService = new LikeService()) {}

  /**
   * Handles quote like request (POST /quotes/:quoteId/like).
   * Requires authenticated user. Returns 200 with { liked: true, quoteId }.
   */
  likeQuote = async (
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
      const result = await this.likeService.likeQuote(req.user.id, quoteId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles quote unlike request (DELETE /quotes/:quoteId/like).
   * Requires authenticated user. Returns 200 with { liked: false, quoteId }.
   */
  unlikeQuote = async (
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
      const result = await this.likeService.unlikeQuote(req.user.id, quoteId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const likeController = new LikeController();
