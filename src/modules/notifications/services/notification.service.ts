import { Notification, NotificationType, PrismaClient } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { generateUuidV7 } from "../../../shared/utils/uuidv7";
import { NotFoundError } from "../../../shared/errors/problem-details";

export class NotificationService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Creates an in-app notification for the recipient user.
   * Enforces self-notification guard: if userId === actorId, skips creation and returns null.
   *
   * @param userId The recipient user ID
   * @param actorId The actor user ID triggering the event
   * @param type Notification type (LIKE, REPOST, FOLLOW)
   * @param entityId Associated entity ID (quoteId or userId)
   */
  async createNotification(
    userId: string,
    actorId: string,
    type: NotificationType,
    entityId: string
  ): Promise<Notification | null> {
    if (userId === actorId) {
      return null;
    }

    const id = generateUuidV7();

    return this.db.notification.create({
      data: {
        id,
        userId,
        actorId,
        type,
        entityId,
      },
    });
  }

  /**
   * Retrieves a chronological list of notifications for the specified user.
   * Defaults to 20 items, clamped between 1 and 100.
   *
   * @param userId The user ID whose notifications to fetch
   * @param limit Maximum number of records to return
   */
  async listNotifications(
    userId: string,
    limit: number = 20
  ): Promise<Notification[]> {
    const parsedLimit = Number.isInteger(limit) ? limit : 20;
    const clampedLimit = Math.max(1, Math.min(parsedLimit, 100));

    return this.db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: clampedLimit,
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profileImageUrl: true,
          },
        },
      },
    });
  }

  /**
   * Marks a specific notification as read.
   * Verifies the notification belongs strictly to the requesting user.
   * If already read, returns the existing record idempotently.
   *
   * @param userId The authenticated user ID
   * @param id The notification UUID
   * @throws NotFoundError if notification does not exist or belongs to another user
   */
  async markAsRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.db.notification.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!notification) {
      throw new NotFoundError("Notification not found");
    }

    if (notification.readAt !== null) {
      return notification;
    }

    return this.db.notification.update({
      where: { id },
      data: {
        readAt: new Date(),
      },
    });
  }

  /**
   * Marks all unread notifications as read for the requesting user.
   * Updates only rows where userId matches and readAt is null.
   *
   * @param userId The authenticated user ID
   * @returns The count of updated notifications
   */
  async markAllAsRead(userId: string): Promise<{ count: number }> {
    const result = await this.db.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return { count: result.count };
  }
}

export const notificationService = new NotificationService();
