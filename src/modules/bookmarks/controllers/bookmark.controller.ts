import { Request, Response, NextFunction } from "express";
import { BookmarkService } from "../services/bookmark.service";
import { AuthenticationError } from "../../../shared/errors/problem-details";

export class BookmarkController {
  constructor(
    private readonly bookmarkService: BookmarkService = new BookmarkService()
  ) {}

  /**
   * Handles bookmark creation request (POST /quotes/:quoteId/bookmark).
   * Requires authenticated user. Returns 200 with { bookmarked: true, quoteId }.
   */
  bookmark = async (
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
      const result = await this.bookmarkService.bookmark(req.user.id, quoteId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  bookmarkQuote = this.bookmark;

  /**
   * Handles bookmark deletion request (DELETE /quotes/:quoteId/bookmark).
   * Requires authenticated user. Returns 200 with { bookmarked: false, quoteId }.
   */
  unbookmark = async (
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
      const result = await this.bookmarkService.unbookmark(req.user.id, quoteId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  unbookmarkQuote = this.unbookmark;

  /**
   * Handles listing user's private bookmarks (GET /users/me/bookmarks).
   * Requires authenticated user. Returns 200 with paginated bookmarks.
   */
  listBookmarks = async (
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

      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const parsedLimit = req.query.limit ? Number(req.query.limit) : 20;
      const limit =
        Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

      const result = await this.bookmarkService.listBookmarks(
        req.user.id,
        cursor,
        limit
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const bookmarkController = new BookmarkController();
