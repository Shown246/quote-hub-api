import { Router } from "express";
import { quoteController } from "../controllers/quote.controller";
import { requireAuth } from "../../../middleware/auth";
import { idempotencyMiddleware } from "../../../middleware/idempotency";
import { quoteCreateRateLimiter } from "../../../middleware/rate-limit";
import { likeRouter } from "../../likes/routes/like.routes";
import { repostRouter } from "../../reposts/routes/repost.routes";
import { bookmarkRouter } from "../../bookmarks/routes/bookmark.routes";

export const quoteRouter = Router();

quoteRouter.use(likeRouter);
quoteRouter.use(repostRouter);
quoteRouter.use(bookmarkRouter);

quoteRouter.post(
  "/",
  requireAuth,
  quoteCreateRateLimiter,
  idempotencyMiddleware("POST /api/v1/quotes"),
  quoteController.createQuote
);

quoteRouter.get("/", quoteController.listQuotes);

quoteRouter.get("/:quoteId", quoteController.getQuote);

quoteRouter.patch(
  "/:quoteId",
  requireAuth,
  quoteController.updateQuote
);

quoteRouter.delete(
  "/:quoteId",
  requireAuth,
  quoteController.deleteQuote
);
