import { Router } from "express";
import { followController } from "../controllers/follow.controller";
import { requireAuth } from "../../../middleware/auth";
import { followRateLimiter } from "../../../middleware/rate-limit";

export const followRouter = Router({ mergeParams: true });

followRouter.post("/:userId/follow", requireAuth, followRateLimiter, followController.followUser);
followRouter.delete("/:userId/follow", requireAuth, followController.unfollowUser);
followRouter.get("/:userId/followers", followController.getFollowers);
followRouter.get("/:userId/following", followController.getFollowing);

