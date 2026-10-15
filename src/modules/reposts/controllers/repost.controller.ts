import { Request, Response, NextFunction } from "express";
import { RepostService } from "../services/repost.service";
import {
  AuthenticationError,
  ValidationError,
} from "../../../shared/errors/problem-details";

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

  /**
   * Handles user reposts list request (GET /users/:userId/reposts).
   * Optional query parameters: cursor (base64url), limit (1-100, default 20).
   * Returns 200 with { data: Quote[], pagination: { nextCursor, hasMore } }.
   */
  getUserReposts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const identifier =
        req.params.userId || req.params.username || req.params.identifier;
      if (!identifier) {
        throw new ValidationError("User identifier is required");
      }

      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const parsedLimit = req.query.limit ? Number(req.query.limit) : 20;
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

      const result = await this.repostService.listUserReposts(
        identifier,
        cursor,
        limit
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const repostController = new RepostController();
