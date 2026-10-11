import { Router } from "express";
import { feedController } from "../controllers/feed.controller";
import { requireAuth, optionalAuth } from "../../../middleware/auth";

export const feedRouter = Router();

feedRouter.get("/following", requireAuth, feedController.getFollowingFeed);
feedRouter.get("/for-you", optionalAuth, feedController.getForYouFeed);
