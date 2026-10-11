import { Job, Worker, WorkerOptions } from "bullmq";
import { DailyMetric } from "@prisma/client";
import { createWorker } from "../infrastructure/queue/bullmq";
import { prisma } from "../infrastructure/database/prisma";
import { logger } from "../infrastructure/logging/logger";

export const ANALYTICS_QUEUE_NAME = "analytics-queue";

export interface AnalyticsJobData {
  date?: string | Date;
  targetDate?: string | Date;
  [key: string]: any;
}

/**
 * Extracts a normalized Date instance from the job parameter or defaults to yesterday UTC.
 */
function resolveTargetDate(jobOrDate?: Job<AnalyticsJobData | string> | Date | string): Date {
  if (jobOrDate instanceof Date && !isNaN(jobOrDate.getTime())) {
    return jobOrDate;
  }

  if (typeof jobOrDate === "string") {
    const parsed = new Date(jobOrDate);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (jobOrDate && typeof jobOrDate === "object" && "data" in jobOrDate) {
    const data = (jobOrDate as Job<AnalyticsJobData | string>).data;
    if (typeof data === "string") {
      try {
        const parsedJson = JSON.parse(data);
        const parsedDate = new Date(parsedJson.date ?? parsedJson.targetDate);
        if (!isNaN(parsedDate.getTime())) {
          return parsedDate;
        }
      } catch {
        const parsedDate = new Date(data);
        if (!isNaN(parsedDate.getTime())) {
          return parsedDate;
        }
      }
    } else if (data && typeof data === "object") {
      const rawDate = data.date ?? data.targetDate;
      if (rawDate) {
        const parsed = rawDate instanceof Date ? rawDate : new Date(rawDate);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
  }

  // Default to yesterday (UTC boundary)
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
}

/**
 * BullMQ processor function that computes daily business metrics rollup and upserts into DailyMetric.
 *
 * @param jobOrDate BullMQ Job instance or explicit target Date
 */
export async function aggregateDailyMetricsJob(
  jobOrDate?: Job<AnalyticsJobData | string> | Date | string
): Promise<DailyMetric> {
  const targetDate = resolveTargetDate(jobOrDate);
  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth();
  const day = targetDate.getUTCDate();

  const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  const dateOnly = startOfDay;

  const jobId = jobOrDate && typeof jobOrDate === "object" && "id" in jobOrDate ? (jobOrDate as Job).id : undefined;

  logger.info(
    { jobId, targetDate: dateOnly.toISOString() },
    "Starting daily analytics aggregation rollup"
  );

  try {
    const [
      registeredUsers,
      quotesCreated,
      likesCreated,
      repostsCreated,
      bookmarksCreated,
      followsCreated,
      quoteUsers,
      likeUsers,
      repostUsers,
      followUsers,
      bookmarkUsers,
    ] = await Promise.all([
      prisma.user.count({
        where: { createdAt: { lte: endOfDay } },
      }),
      prisma.quote.count({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      }),
      prisma.like.count({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      }),
      prisma.repost.count({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      }),
      prisma.bookmark.count({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      }),
      prisma.follow.count({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      }),
      prisma.quote.findMany({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.like.findMany({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.repost.findMany({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.follow.findMany({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        select: { followerId: true },
        distinct: ["followerId"],
      }),
      prisma.bookmark.findMany({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);

    const activeUserIds = new Set<string>();
    for (const item of quoteUsers) activeUserIds.add(item.userId);
    for (const item of likeUsers) activeUserIds.add(item.userId);
    for (const item of repostUsers) activeUserIds.add(item.userId);
    for (const item of followUsers) activeUserIds.add(item.followerId);
    for (const item of bookmarkUsers) activeUserIds.add(item.userId);
    const activeUsers = activeUserIds.size;

    const metric = await prisma.dailyMetric.upsert({
      where: { metricDate: dateOnly },
      update: {
        registeredUsers,
        activeUsers,
        quotesCreated,
        likesCreated,
        repostsCreated,
        bookmarksCreated,
        followsCreated,
      },
      create: {
        metricDate: dateOnly,
        registeredUsers,
        activeUsers,
        quotesCreated,
        likesCreated,
        repostsCreated,
        bookmarksCreated,
        followsCreated,
      },
    });

    logger.info(
      {
        jobId,
        metricDate: dateOnly.toISOString(),
        registeredUsers,
        activeUsers,
        quotesCreated,
        likesCreated,
        repostsCreated,
        bookmarksCreated,
        followsCreated,
      },
      "Successfully aggregated and upserted daily metrics"
    );

    return metric;
  } catch (error) {
    logger.error(
      { err: error, jobId, targetDate: dateOnly.toISOString() },
      "Failed to aggregate daily metrics rollup"
    );
    throw error;
  }
}

let analyticsWorkerInstance: Worker | null = null;

/**
 * Initializes and starts the BullMQ worker consuming jobs from 'analytics-queue'.
 */
export function startAnalyticsWorker(opts?: Partial<WorkerOptions>): Worker {
  if (!analyticsWorkerInstance) {
    analyticsWorkerInstance = createWorker(
      ANALYTICS_QUEUE_NAME,
      aggregateDailyMetricsJob,
      opts
    );
  }
  return analyticsWorkerInstance;
}

/**
 * Closes the analytics worker instance cleanly.
 */
export async function stopAnalyticsWorker(): Promise<void> {
  if (analyticsWorkerInstance) {
    await analyticsWorkerInstance.close();
    analyticsWorkerInstance = null;
  }
}
