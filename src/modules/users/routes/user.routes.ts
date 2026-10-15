import { Router } from "express";
import { userController } from "../controllers/user.controller";
import { bookmarkController } from "../../bookmarks/controllers/bookmark.controller";
import { repostController } from "../../reposts/controllers/repost.controller";
import { followRouter } from "../../follows/routes/follow.routes";
import { requireAuth } from "../../../middleware/auth";
import { idempotencyMiddleware } from "../../../middleware/idempotency";

export const userRouter = Router();

userRouter.use(followRouter);

userRouter.get("/me", requireAuth, userController.getCurrentUser);
userRouter.patch("/me", requireAuth, userController.updateProfile);
userRouter.post("/me/username", requireAuth, userController.finalizeUsername);
userRouter.post("/me/profile-image", requireAuth, userController.requestAvatarUpload);
userRouter.post(
  "/me/profile-image/confirm",
  requireAuth,
  idempotencyMiddleware("POST /api/v1/users/me/profile-image/confirm"),
  userController.confirmAvatarUpload
);
userRouter.delete("/me", requireAuth, userController.deleteAccount);
userRouter.get("/me/bookmarks", requireAuth, bookmarkController.listBookmarks);
userRouter.get("/:userId/reposts", repostController.getUserReposts);
userRouter.get("/:username", userController.getProfile);
