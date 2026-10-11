import { Job, Worker, WorkerOptions } from "bullmq";
import { NotificationType, Notification } from "@prisma/client";
import { createWorker } from "../infrastructure/queue/bullmq";
import { notificationService } from "../modules/notifications/services/notification.service";
import { logger } from "../infrastructure/logging/logger";

export const NOTIFICATIONS_QUEUE_NAME = "notifications-queue";

export interface NotificationJobPayload {
  actorId?: string;
  recipientId?: string;
  quoteId?: string;
  followingId?: string;
  [key: string]: any;
}

/**
 * BullMQ processor function that handles notification domain events from 'notifications-queue'.
 *
 * Supported events:
 * - LikeCreated: creates LIKE notification for quote owner
 * - RepostCreated: creates REPOST notification for quote owner
 * - FollowCreated: creates FOLLOW notification for followed user
 *
 * Enforces self-notification suppression via NotificationService.
 */
export async function processNotificationJob(
  job: Job<NotificationJobPayload | string>
): Promise<Notification | null> {
  const rawData = job.data;
  let payload: NotificationJobPayload;
  if (typeof rawData === "string") {
    try {
      payload = JSON.parse(rawData);
    } catch {
      payload = {};
    }
  } else {
    payload = rawData ?? {};
  }

  const eventName = job.name;
  let type: NotificationType;
  let entityId: string | undefined;
  let recipientId = payload?.recipientId;
  const actorId = payload?.actorId;

  switch (eventName) {
    case "LikeCreated":
      type = NotificationType.LIKE;
      entityId = payload?.quoteId;
      break;

    case "RepostCreated":
      type = NotificationType.REPOST;
      entityId = payload?.quoteId;
      break;

    case "FollowCreated":
      type = NotificationType.FOLLOW;
      entityId = payload?.recipientId ?? payload?.followingId;
      recipientId = recipientId ?? payload?.followingId;
      break;

    default:
      logger.debug(
        { jobName: eventName, jobId: job.id },
        "Ignoring non-notification event in notifications-queue"
      );
      return null;
  }

  if (!recipientId || !actorId || !entityId) {
    logger.warn(
      {
        jobName: eventName,
        jobId: job.id,
        recipientId,
        actorId,
        entityId,
      },
      "Missing required fields for notification job payload"
    );
    return null;
  }

  const notification = await notificationService.createNotification(
    recipientId,
    actorId,
    type,
    entityId
  );

  if (notification) {
    logger.info(
      {
        notificationId: notification.id,
        recipientId,
        actorId,
        type,
        entityId,
      },
      "Successfully created in-app notification"
    );
  }

  return notification;
}

let notificationWorkerInstance: Worker | null = null;

/**
 * Initializes and starts the BullMQ worker for the notifications-queue.
 */
export function startNotificationWorker(
  opts?: Partial<WorkerOptions>
): Worker {
  if (!notificationWorkerInstance) {
    notificationWorkerInstance = createWorker(
      NOTIFICATIONS_QUEUE_NAME,
      processNotificationJob,
      opts
    );
  }
  return notificationWorkerInstance;
}

/**
 * Closes the notifications worker instance cleanly.
 */
export async function stopNotificationWorker(): Promise<void> {
  if (notificationWorkerInstance) {
    await notificationWorkerInstance.close();
    notificationWorkerInstance = null;
  }
}
