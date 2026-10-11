import { startOutboxWorker } from "./outbox.worker";
import {
  startNotificationWorker,
  stopNotificationWorker,
} from "./notifications.worker";
import { startMediaWorker, stopMediaWorker } from "./media.worker";
import {
  startTrendingWorker,
  stopTrendingWorker,
  TRENDING_QUEUE_NAME,
} from "./trending.worker";
import {
  startAnalyticsWorker,
  stopAnalyticsWorker,
  ANALYTICS_QUEUE_NAME,
} from "./analytics.worker";
import {
  startUserCleanupWorker,
  stopUserCleanupWorker,
} from "./user-cleanup.worker";
import { getQueue } from "../infrastructure/queue/bullmq";
import { logger } from "../infrastructure/logging/logger";

let stopOutboxPoller: (() => void) | null = null;
let isStarted = false;

/**
 * Returns whether background workers are currently active.
 */
export function areWorkersRunning(): boolean {
  return isStarted;
}

/**
 * Starts all Quote-Hub background workers and schedules recurring repeatable jobs:
 * 1. Transactional Outbox poller loop
 * 2. In-app notifications worker ('notifications-queue')
 * 3. Media avatar processing worker ('media-queue')
 * 4. Trending quotes recalculation worker ('trending-queue')
 * 5. Analytics rollup worker ('analytics-queue')
 * 6. User account cleanup worker ('user-cleanup-queue')
 *
 * Configures repeatable jobs:
 * - 'recalculate-trending' on 'trending-queue': hourly at :00 ('0 * * * *')
 * - 'aggregate-daily-metrics' on 'analytics-queue': daily at 00:05 ('5 0 * * *')
 */
export async function startAllWorkers(): Promise<void> {
  logger.info("Starting all Quote-Hub background workers...");

  // 1. Start outbox polling worker loop
  stopOutboxPoller = startOutboxWorker();

  // 2. Start BullMQ queue workers
  startNotificationWorker();
  startMediaWorker();
  startTrendingWorker();
  startAnalyticsWorker();
  startUserCleanupWorker();

  // 3. Configure repeatable scheduled jobs
  const trendingQueue = getQueue(TRENDING_QUEUE_NAME);
  await trendingQueue.add(
    "recalculate-trending",
    {},
    {
      repeat: { pattern: "*/5 * * * *" }, // Conforming to TDD § 51 (every 1-5 minutes)
    } as any
  );

  const analyticsQueue = getQueue(ANALYTICS_QUEUE_NAME);
  await analyticsQueue.add(
    "aggregate-daily-metrics",
    {},
    {
      repeat: { pattern: "5 0 * * *" },
    } as any
  );

  isStarted = true;
  logger.info("All Quote-Hub background workers and scheduled jobs initialized");
}

/**
 * Gracefully shuts down all active background workers and stops the outbox poller.
 */
export async function stopAllWorkers(): Promise<void> {
  logger.info("Stopping all Quote-Hub background workers...");

  // 1. Stop outbox poller loop if active
  if (stopOutboxPoller) {
    stopOutboxPoller();
    stopOutboxPoller = null;
  }

  // 2. Close all BullMQ workers cleanly
  await Promise.all([
    stopNotificationWorker(),
    stopMediaWorker(),
    stopTrendingWorker(),
    stopAnalyticsWorker(),
    stopUserCleanupWorker(),
  ]);

  isStarted = false;
  logger.info("All Quote-Hub background workers stopped");
}

if (require.main === module) {
  startAllWorkers().catch((err) => {
    logger.error({ err }, "Failed to start background workers");
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful worker shutdown...`);
    await stopAllWorkers();
    process.exit(0);
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
