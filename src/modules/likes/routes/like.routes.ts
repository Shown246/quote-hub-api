import { Router } from "express";
import { likeController } from "../controllers/like.controller";
import { requireAuth } from "../../../middleware/auth";
import { likeRateLimiter } from "../../../middleware/rate-limit";

export const likeRouter = Router({ mergeParams: true });

likeRouter.post("/:quoteId/like", requireAuth, likeRateLimiter, likeController.likeQuote);
likeRouter.delete("/:quoteId/like", requireAuth, likeController.unlikeQuote);

