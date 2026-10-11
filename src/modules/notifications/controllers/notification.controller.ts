import { Request, Response, NextFunction } from "express";
import {
  NotificationService,
  notificationService,
} from "../services/notification.service";
import { AuthenticationError } from "../../../shared/errors/problem-details";

export class NotificationController {
  constructor(
    private readonly notificationServiceInstance: NotificationService = notificationService
  ) {}

  /**
   * Handles GET /api/v1/notifications:
   * Retrieves paginated list of notifications for the authenticated user.
   */
  listNotifications = async (
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
      const notifications =
        await this.notificationServiceInstance.listNotifications(
          req.user.id,
          limit
        );

      res.status(200).json({ data: notifications });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles PATCH /api/v1/notifications/:id/read:
   * Marks a single notification as read for the authenticated user.
   */
  markAsRead = async (
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

      const id = req.params.id || req.params.notificationId;
      const notification =
        await this.notificationServiceInstance.markAsRead(req.user.id, id);

      res.status(200).json(notification);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles PATCH /api/v1/notifications/read-all:
   * Marks all unread notifications as read for the authenticated user.
   */
  markAllAsRead = async (
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

      const result = await this.notificationServiceInstance.markAllAsRead(
        req.user.id
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Helper to parse and clamp limit query parameter.
   */
  private parseLimit(limitParam: unknown): number {
    if (limitParam === undefined || limitParam === null || limitParam === "") {
      return 20;
    }
    const num = Number(limitParam);
    if (!Number.isInteger(num)) {
      return 20;
    }
    return Math.max(1, Math.min(num, 100));
  }
}

export const notificationController = new NotificationController();
