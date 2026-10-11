import { Request, Response, NextFunction } from "express";
import { FeedService, feedService } from "../services/feed.service";
import { decodeCursor } from "../../../shared/utils/cursor";
import {
  AuthenticationError,
  ValidationError,
} from "../../../shared/errors/problem-details";

export class FeedController {
  constructor(
    private readonly feedServiceInstance: FeedService = feedService
  ) {}

  /**
   * Handles GET /api/v1/feed/following.
   * Requires authenticated user.
   * Parses cursor and limit (clamp 1-50, default 20).
   */
  getFollowingFeed = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const limit = this.parseLimit(req.query.limit);
      const cursor = this.parseCursor(req.query.cursor);

      const result = await this.feedServiceInstance.getFollowingFeed(
        req.user.id,
        cursor,
        limit
      );

      res.status(200).json({
        data: result.items,
        pagination: {
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles GET /api/v1/feed/for-you.
   * Public endpoint with optional authentication.
   * Parses cursor and limit (clamp 1-50, default 20).
   */
  getForYouFeed = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      const limit = this.parseLimit(req.query.limit);
      const cursor = this.parseCursor(req.query.cursor);

      const result = await this.feedServiceInstance.getForYouFeed(
        userId,
        cursor,
        limit
      );

      res.status(200).json({
        data: result.items,
        pagination: {
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Clamps and validates the limit query parameter.
   */
  private parseLimit(limitParam: unknown): number {
    if (limitParam === undefined || limitParam === null || limitParam === "") {
      return 20;
    }
    const num = Number(limitParam);
    if (!Number.isInteger(num) || num <= 0) {
      return 20;
    }
    return Math.max(1, Math.min(num, 50));
  }

  /**
   * Validates and returns the cursor query parameter if provided.
   */
  private parseCursor(cursorParam: unknown): string | undefined {
    if (typeof cursorParam !== "string" || cursorParam.trim().length === 0) {
      return undefined;
    }
    const trimmed = cursorParam.trim();
    const decoded = decodeCursor(trimmed);
    if (!decoded) {
      throw new ValidationError("Invalid pagination cursor");
    }
    return trimmed;
  }
}

export const feedController = new FeedController();
