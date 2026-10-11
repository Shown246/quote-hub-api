import { Prisma, OutboxStatus } from "@prisma/client";
import { prisma } from "../infrastructure/database/prisma";
import { getQueue } from "../infrastructure/queue/bullmq";
import { logger } from "../infrastructure/logging/logger";

/**
 * Standard queue identifiers used across Quote-Hub async processing.
 */
export const QUEUES = {
  NOTIFICATIONS: "notifications-queue",
  USER_CLEANUP: "user-cleanup-queue",
  MEDIA: "media-queue",
} as const;

/**
 * Raw outbox row representation supporting both PostgreSQL snake_case column names
 * and Prisma Client camelCase properties defensively.
 */
export interface RawOutboxRow {
  id: string;
  event_type?: string;
  eventType?: string;
  aggregate_type?: string;
  aggregateType?: string;
  aggregate_id?: string;
  aggregateId?: string;
  payload?: any;
  status?: string;
  retry_count?: number;
  retryCount?: number;
  last_error?: string | null;
  lastError?: string | null;
  scheduled_at?: Date;
  scheduledAt?: Date;
  processed_at?: Date | null;
  processedAt?: Date | null;
  created_at?: Date;
  createdAt?: Date;
}

/**
 * Resolves the destination BullMQ queue identifier based on domain event type
 * and aggregate type, adhering to the pre-flight routing rulings.
 *
 * Routing rules:
 * 1. Domain events LikeCreated, RepostCreated, FollowCreated -> notifications-queue
 * 2. UserDeleted -> user-cleanup-queue
 * 3. AvatarUploaded or aggregateType Media -> media-queue
 * 4. AggregateType Quote -> notifications-queue
 * 5. AggregateType User (non-follow) -> user-cleanup-queue
 * 6. General fallback -> notifications-queue
 */
export function resolveQueueName(eventType: string, aggregateType: string): string {
  // 1. Explicit domain event type routing
  if (
    eventType === "LikeCreated" ||
    eventType === "RepostCreated" ||
    eventType === "FollowCreated"
  ) {
    return QUEUES.NOTIFICATIONS;
  }

  if (eventType === "UserDeleted") {
    return QUEUES.USER_CLEANUP;
  }

  if (eventType === "AvatarUploaded" || aggregateType === "Media") {
    return QUEUES.MEDIA;
  }

  // 2. Aggregate type fallback routing
  if (aggregateType === "Quote") {
    return QUEUES.NOTIFICATIONS;
  }

  if (aggregateType === "User") {
    return QUEUES.USER_CLEANUP;
  }

  // 3. Fallback default
  return QUEUES.NOTIFICATIONS;
}

/**
 * Maximum retry attempts before marking an outbox event as FAILED.
 */
const MAX_RETRIES = 5;

/**
 * Polls the outbox_events table for pending events using FOR UPDATE SKIP LOCKED,
 * atomically transitioning claimed rows to PROCESSING, and enqueues them to
 * appropriate BullMQ queues.
 *
 * @param batchSize - Maximum number of rows to claim and dispatch per poll cycle (default 50)
 * @returns The count of successfully dispatched and published outbox events
 */
export async function pollAndDispatchOutbox(batchSize: number = 50): Promise<number> {
  const limit = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 50;

  // Claim pending events using FOR UPDATE SKIP LOCKED CTE (Section 8.4)
  const rows = await prisma.$queryRaw<RawOutboxRow[]>(
    Prisma.sql`
      WITH claimed AS (
        SELECT id 
        FROM outbox_events
        WHERE status = 'PENDING' 
          AND scheduled_at <= CURRENT_TIMESTAMP
        ORDER BY scheduled_at ASC, created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events
      SET status = 'PROCESSING'
      FROM claimed
      WHERE outbox_events.id = claimed.id
      RETURNING outbox_events.*;
    `
  );

  const claimedRows = Array.isArray(rows) ? rows : [];
  if (claimedRows.length === 0) {
    return 0;
  }

  let dispatchedCount = 0;

  for (const row of claimedRows) {
    const id = row.id;
    if (!id) {
      continue;
    }

    const eventType = row.event_type ?? row.eventType ?? "";
    const aggregateType = row.aggregate_type ?? row.aggregateType ?? "";
    const retryCount = Number(row.retry_count ?? row.retryCount ?? 0);

    let payload = row.payload ?? {};
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        // Retain raw string payload if not valid JSON
      }
    }

    const queueName = resolveQueueName(eventType, aggregateType);
    const queue = getQueue(queueName);

    let enqueued = false;
    try {
      await queue.add(eventType, payload, { jobId: id });
      enqueued = true;
    } catch (enqueueError) {
      const errorMessage =
        enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
      const nextRetry = retryCount + 1;

      logger.error(
        {
          err: enqueueError,
          outboxEventId: id,
          eventType,
          aggregateType,
          retryCount: nextRetry,
        },
        "Failed to enqueue outbox event to BullMQ queue"
      );

      try {
        if (nextRetry >= MAX_RETRIES) {
          await prisma.outboxEvent.update({
            where: { id },
            data: {
              status: OutboxStatus.FAILED,
              retryCount: nextRetry,
              lastError: errorMessage,
            },
          });
        } else {
          // Exponential backoff: 2^(retryCount + 1) seconds
          const backoffDelaySeconds = Math.pow(2, nextRetry);
          const scheduledAt = new Date(Date.now() + backoffDelaySeconds * 1000);

          await prisma.outboxEvent.update({
            where: { id },
            data: {
              status: OutboxStatus.PENDING,
              retryCount: nextRetry,
              lastError: errorMessage,
              scheduledAt,
            },
          });
        }
      } catch (dbError) {
        logger.error(
          { err: dbError, outboxEventId: id },
          "Failed to update outbox event retry status in database"
        );
      }

      continue;
    }

    if (enqueued) {
      try {
        await prisma.outboxEvent.update({
          where: { id },
          data: {
            status: OutboxStatus.PUBLISHED,
            processedAt: new Date(),
          },
        });
        dispatchedCount++;
      } catch (dbError) {
        logger.error(
          { err: dbError, outboxEventId: id },
          "Failed to mark outbox event as PUBLISHED in database"
        );
      }
    }
  }

  return dispatchedCount;
}

/**
 * Starts the transactional outbox polling worker loop on a recurring interval.
 *
 * @param intervalMs - Polling interval in milliseconds (default: 2000ms)
 * @returns A teardown function to stop the polling loop cleanly
 */
export function startOutboxWorker(intervalMs: number = 2000): () => void {
  let isPolling = false;
  let isStopped = false;

  const timer = setInterval(async () => {
    if (isPolling || isStopped) {
      return;
    }

    isPolling = true;
    try {
      await pollAndDispatchOutbox();
    } catch (err) {
      logger.error({ err }, "Unexpected error in outbox worker polling iteration");
    } finally {
      isPolling = false;
    }
  }, intervalMs);

  return () => {
    isStopped = true;
    clearInterval(timer);
  };
}
