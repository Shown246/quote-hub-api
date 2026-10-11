import { Job, Worker, WorkerOptions } from "bullmq";
import { createWorker } from "../infrastructure/queue/bullmq";
import { trendingService } from "../modules/trending/services/trending.service";
import { logger } from "../infrastructure/logging/logger";

export const TRENDING_QUEUE_NAME = "trending-queue";

/**
 * BullMQ processor function that executes trending score recalculation.
 * Recalculates velocity scores for quotes created within the last 24 hours
 * and refreshes the Redis sorted set `trending:global:24h`.
 *
 * @param job BullMQ job instance (optional)
 */
export async function recalculateTrendingJob(job?: Job): Promise<void> {
  logger.info(
    { jobId: job?.id, jobName: job?.name },
    "Starting trending score recalculation job"
  );

  try {
    await trendingService.recalculateTrendingScores();
    logger.info(
      { jobId: job?.id },
      "Successfully completed trending score recalculation job"
    );
  } catch (error) {
    logger.error(
      { err: error, jobId: job?.id },
      "Error occurred during trending score recalculation job"
    );
    throw error;
  }
}

let trendingWorkerInstance: Worker | null = null;

/**
 * Initializes and starts the BullMQ worker consuming jobs from 'trending-queue'.
 */
export function startTrendingWorker(opts?: Partial<WorkerOptions>): Worker {
  if (!trendingWorkerInstance) {
    trendingWorkerInstance = createWorker(
      TRENDING_QUEUE_NAME,
      recalculateTrendingJob,
      opts
    );
  }
  return trendingWorkerInstance;
}

/**
 * Closes the trending worker instance cleanly.
 */
export async function stopTrendingWorker(): Promise<void> {
  if (trendingWorkerInstance) {
    await trendingWorkerInstance.close();
    trendingWorkerInstance = null;
  }
}
