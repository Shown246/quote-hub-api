import { Router } from "express";
import { repostController } from "../controllers/repost.controller";
import { requireAuth } from "../../../middleware/auth";
import { repostRateLimiter } from "../../../middleware/rate-limit";

export const repostRouter = Router({ mergeParams: true });

repostRouter.post("/:quoteId/repost", requireAuth, repostRateLimiter, repostController.repostQuote);
repostRouter.delete("/:quoteId/repost", requireAuth, repostController.unrepostQuote);

