import { Router } from "express";
import { notificationController } from "../controllers/notification.controller";
import { requireAuth } from "../../../middleware/auth";
import { notificationRateLimiter } from "../../../middleware/rate-limit";

export const notificationRouter = Router();

notificationRouter.use(notificationRateLimiter);

// GET /api/v1/notifications - List notifications for authenticated user
notificationRouter.get(
  "/",
  requireAuth,
  notificationController.listNotifications
);

// PATCH /api/v1/notifications/read-all - Mark all unread notifications as read
// NOTE: Must be registered BEFORE /:id/read to prevent parameter collision
notificationRouter.patch(
  "/read-all",
  requireAuth,
  notificationController.markAllAsRead
);

// PATCH /api/v1/notifications/:id/read - Mark single notification as read
notificationRouter.patch(
  "/:id/read",
  requireAuth,
  notificationController.markAsRead
);
