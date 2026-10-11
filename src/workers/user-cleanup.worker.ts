import { Job, Worker, WorkerOptions } from "bullmq";
import { createWorker } from "../infrastructure/queue/bullmq";
import { prisma } from "../infrastructure/database/prisma";
import { logger } from "../infrastructure/logging/logger";

export const USER_CLEANUP_QUEUE_NAME = "user-cleanup-queue";

export interface UserCleanupJobPayload {
  userId?: string;
  id?: string;
  aggregateId?: string;
  user_id?: string;
  [key: string]: any;
}

/**
 * Executes the PostgreSQL stored procedure `purge_deleted_user_data(target_user_id UUID)`
 * to asynchronously hard-purge interaction edges, follow relationships, unread notifications,
 * and mark owned quotes as soft-deleted for a soft-deleted user account.
 *
 * @param userId - Unique identifier (UUID) of the soft-deleted user
 */
export async function cleanupDeletedUserJob(userId: string): Promise<void> {
  logger.info({ userId }, "Executing purge_deleted_user_data stored procedure");

  try {
    await prisma.$executeRaw`CALL purge_deleted_user_data(${userId}::uuid)`;
    logger.info({ userId }, "Successfully purged soft-deleted user data");
  } catch (error) {
    logger.error(
      { err: error, userId },
      "Error executing purge_deleted_user_data stored procedure"
    );
    throw error;
  }
}

/**
 * BullMQ processor function that consumes user cleanup jobs from 'user-cleanup-queue'.
 * Extracts the user identifier from multiple potential payload representations (userId, id, aggregateId),
 * handles raw or serialized JSON payloads, and invokes cleanupDeletedUserJob.
 *
 * @param job - BullMQ Job instance
 */
export async function processUserCleanupJob(
  job: Job<UserCleanupJobPayload | string>
): Promise<void> {
  const rawData = job.data;
  let userId: string | undefined;

  if (typeof rawData === "string") {
    try {
      const parsed = JSON.parse(rawData);
      if (typeof parsed === "string") {
        userId = parsed.trim() || undefined;
      } else if (parsed && typeof parsed === "object") {
        userId =
          parsed.userId ??
          parsed.id ??
          parsed.aggregateId ??
          parsed.user_id;
      }
    } catch {
      userId = rawData.trim() || undefined;
    }
  } else if (rawData && typeof rawData === "object") {
    userId =
      rawData.userId ??
      rawData.id ??
      rawData.aggregateId ??
      rawData.user_id;
  }

  if (!userId) {
    logger.error(
      { jobId: job.id, jobName: job.name, data: job.data },
      "Missing userId in user cleanup job payload"
    );
    throw new Error("Missing userId in user cleanup job payload");
  }

  logger.info(
    { jobId: job.id, jobName: job.name, userId },
    "Processing user cleanup job"
  );

  try {
    await cleanupDeletedUserJob(userId);
    logger.info(
      { jobId: job.id, userId },
      "Successfully processed user cleanup job"
    );
  } catch (error) {
    logger.error(
      { err: error, jobId: job.id, userId },
      "Failed to process user cleanup job"
    );
    throw error;
  }
}

let userCleanupWorkerInstance: Worker | null = null;

/**
 * Initializes and starts the BullMQ worker consuming jobs from 'user-cleanup-queue'.
 * Implements singleton worker lifecycle management.
 *
 * @param opts - Optional BullMQ WorkerOptions overrides
 */
export function startUserCleanupWorker(opts?: Partial<WorkerOptions>): Worker {
  if (!userCleanupWorkerInstance) {
    userCleanupWorkerInstance = createWorker(
      USER_CLEANUP_QUEUE_NAME,
      processUserCleanupJob,
      opts
    );
  }
  return userCleanupWorkerInstance;
}

/**
 * Closes the user cleanup worker instance cleanly and resets the singleton.
 */
export async function stopUserCleanupWorker(): Promise<void> {
  if (userCleanupWorkerInstance) {
    await userCleanupWorkerInstance.close();
    userCleanupWorkerInstance = null;
  }
}
