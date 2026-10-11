import { Router } from "express";
import { bookmarkController } from "../controllers/bookmark.controller";
import { requireAuth } from "../../../middleware/auth";

export const bookmarkRouter = Router({ mergeParams: true });
export const bookmarkQuoteRouter = bookmarkRouter;

bookmarkRouter.post(
  "/:quoteId/bookmark",
  requireAuth,
  bookmarkController.bookmark
);

bookmarkRouter.delete(
  "/:quoteId/bookmark",
  requireAuth,
  bookmarkController.unbookmark
);
