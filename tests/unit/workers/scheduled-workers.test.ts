import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recalculateTrendingJob,
  startTrendingWorker,
  stopTrendingWorker,
  TRENDING_QUEUE_NAME,
} from "../../../src/workers/trending.worker";
import {
  aggregateDailyMetricsJob,
  startAnalyticsWorker,
  stopAnalyticsWorker,
  ANALYTICS_QUEUE_NAME,
} from "../../../src/workers/analytics.worker";
import { trendingService } from "../../../src/modules/trending/services/trending.service";
import { prisma } from "../../../src/infrastructure/database/prisma";
import * as bullmqModule from "../../../src/infrastructure/queue/bullmq";

describe("Scheduled Workers", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await stopTrendingWorker();
    await stopAnalyticsWorker();
  });

  describe("trending.worker", () => {
    describe("recalculateTrendingJob", () => {
      it("delegates to trendingService.recalculateTrendingScores() with job argument", async () => {
        const spy = vi
          .spyOn(trendingService, "recalculateTrendingScores")
          .mockResolvedValueOnce(undefined);

        const mockJob = {
          id: "job-trending-1",
          name: "recalculateTrending",
        } as any;

        await recalculateTrendingJob(mockJob);

        expect(spy).toHaveBeenCalledTimes(1);
      });

      it("delegates to trendingService.recalculateTrendingScores() without job argument", async () => {
        const spy = vi
          .spyOn(trendingService, "recalculateTrendingScores")
          .mockResolvedValueOnce(undefined);

        await recalculateTrendingJob();

        expect(spy).toHaveBeenCalledTimes(1);
      });

      it("re-throws error if trendingService.recalculateTrendingScores fails", async () => {
        vi.spyOn(trendingService, "recalculateTrendingScores").mockRejectedValueOnce(
          new Error("Redis connection dropped")
        );

        await expect(recalculateTrendingJob()).rejects.toThrow("Redis connection dropped");
      });
    });

    describe("startTrendingWorker and stopTrendingWorker", () => {
      it("creates worker on 'trending-queue' and closes cleanly", async () => {
        const mockWorker = {
          close: vi.fn().mockResolvedValue(undefined),
        };
        const createWorkerSpy = vi
          .spyOn(bullmqModule, "createWorker")
          .mockReturnValue(mockWorker as any);

        const worker1 = startTrendingWorker();
        expect(createWorkerSpy).toHaveBeenCalledWith(
          TRENDING_QUEUE_NAME,
          recalculateTrendingJob,
          undefined
        );
        expect(worker1).toBe(mockWorker);

        // Subsequent call reuses singleton
        const worker2 = startTrendingWorker();
        expect(worker2).toBe(mockWorker);
        expect(createWorkerSpy).toHaveBeenCalledTimes(1);

        // Stop worker
        await stopTrendingWorker();
        expect(mockWorker.close).toHaveBeenCalledTimes(1);

        // Calling start after stop creates fresh worker
        startTrendingWorker();
        expect(createWorkerSpy).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("analytics.worker", () => {
    describe("aggregateDailyMetricsJob", () => {
      it("computes counts for an explicit Date and upserts DailyMetric with normalized UTC Date", async () => {
        const targetDate = new Date(Date.UTC(2026, 9, 7)); // 2026-10-07
        const expectedStartOfDay = new Date(Date.UTC(2026, 9, 7, 0, 0, 0, 0));
        const expectedEndOfDay = new Date(Date.UTC(2026, 9, 7, 23, 59, 59, 999));

        const userCountSpy = vi.spyOn(prisma.user, "count").mockResolvedValue(150);
        const quoteCountSpy = vi.spyOn(prisma.quote, "count").mockResolvedValue(25);
        const likeCountSpy = vi.spyOn(prisma.like, "count").mockResolvedValue(80);
        const repostCountSpy = vi.spyOn(prisma.repost, "count").mockResolvedValue(12);
        const bookmarkCountSpy = vi.spyOn(prisma.bookmark, "count").mockResolvedValue(18);
        const followCountSpy = vi.spyOn(prisma.follow, "count").mockResolvedValue(9);

        const quoteFindSpy = vi.spyOn(prisma.quote, "findMany").mockResolvedValue([
          { userId: "u1" },
          { userId: "u2" },
        ] as any);
        const likeFindSpy = vi.spyOn(prisma.like, "findMany").mockResolvedValue([
          { userId: "u2" },
          { userId: "u3" },
        ] as any);
        const repostFindSpy = vi.spyOn(prisma.repost, "findMany").mockResolvedValue([
          { userId: "u1" },
        ] as any);
        const followFindSpy = vi.spyOn(prisma.follow, "findMany").mockResolvedValue([
          { followerId: "u4" },
        ] as any);
        const bookmarkFindSpy = vi.spyOn(prisma.bookmark, "findMany").mockResolvedValue([
          { userId: "u3" },
          { userId: "u5" },
        ] as any);

        const expectedRecord = {
          metricDate: expectedStartOfDay,
          registeredUsers: 150,
          activeUsers: 5, // u1, u2, u3, u4, u5
          quotesCreated: 25,
          likesCreated: 80,
          repostsCreated: 12,
          bookmarksCreated: 18,
          followsCreated: 9,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const upsertSpy = vi
          .spyOn(prisma.dailyMetric, "upsert")
          .mockResolvedValue(expectedRecord as any);

        const result = await aggregateDailyMetricsJob(targetDate);

        expect(userCountSpy).toHaveBeenCalledWith({
          where: { createdAt: { lte: expectedEndOfDay } },
        });
        expect(quoteCountSpy).toHaveBeenCalledWith({
          where: { createdAt: { gte: expectedStartOfDay, lte: expectedEndOfDay } },
        });
        expect(likeCountSpy).toHaveBeenCalledWith({
          where: { createdAt: { gte: expectedStartOfDay, lte: expectedEndOfDay } },
        });
        expect(repostCountSpy).toHaveBeenCalledWith({
          where: { createdAt: { gte: expectedStartOfDay, lte: expectedEndOfDay } },
        });
        expect(bookmarkCountSpy).toHaveBeenCalledWith({
          where: { createdAt: { gte: expectedStartOfDay, lte: expectedEndOfDay } },
        });
        expect(followCountSpy).toHaveBeenCalledWith({
          where: { createdAt: { gte: expectedStartOfDay, lte: expectedEndOfDay } },
        });

        // 5 distinct active users: u1, u2, u3, u4, u5
        expect(upsertSpy).toHaveBeenCalledWith({
          where: { metricDate: expectedStartOfDay },
          update: {
            registeredUsers: 150,
            activeUsers: 5,
            quotesCreated: 25,
            likesCreated: 80,
            repostsCreated: 12,
            bookmarksCreated: 18,
            followsCreated: 9,
          },
          create: {
            metricDate: expectedStartOfDay,
            registeredUsers: 150,
            activeUsers: 5,
            quotesCreated: 25,
            likesCreated: 80,
            repostsCreated: 12,
            bookmarksCreated: 18,
            followsCreated: 9,
          },
        });

        expect(result).toEqual(expectedRecord);
      });

      it("handles BullMQ job with data.date string payload", async () => {
        vi.spyOn(prisma.user, "count").mockResolvedValue(50);
        vi.spyOn(prisma.quote, "count").mockResolvedValue(10);
        vi.spyOn(prisma.like, "count").mockResolvedValue(20);
        vi.spyOn(prisma.repost, "count").mockResolvedValue(5);
        vi.spyOn(prisma.bookmark, "count").mockResolvedValue(2);
        vi.spyOn(prisma.follow, "count").mockResolvedValue(1);
        vi.spyOn(prisma.quote, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.like, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.repost, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.follow, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.bookmark, "findMany").mockResolvedValue([] as any);

        const upsertSpy = vi
          .spyOn(prisma.dailyMetric, "upsert")
          .mockResolvedValue({} as any);

        const mockJob = {
          id: "job-analytics-1",
          data: {
            date: "2026-10-06T12:00:00.000Z",
          },
        } as any;

        await aggregateDailyMetricsJob(mockJob);

        const expectedStartOfDay = new Date(Date.UTC(2026, 9, 6, 0, 0, 0, 0));
        expect(upsertSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { metricDate: expectedStartOfDay },
          })
        );
      });

      it("handles BullMQ job with JSON stringified data", async () => {
        vi.spyOn(prisma.user, "count").mockResolvedValue(50);
        vi.spyOn(prisma.quote, "count").mockResolvedValue(10);
        vi.spyOn(prisma.like, "count").mockResolvedValue(20);
        vi.spyOn(prisma.repost, "count").mockResolvedValue(5);
        vi.spyOn(prisma.bookmark, "count").mockResolvedValue(2);
        vi.spyOn(prisma.follow, "count").mockResolvedValue(1);
        vi.spyOn(prisma.quote, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.like, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.repost, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.follow, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.bookmark, "findMany").mockResolvedValue([] as any);

        const upsertSpy = vi
          .spyOn(prisma.dailyMetric, "upsert")
          .mockResolvedValue({} as any);

        const mockJob = {
          id: "job-analytics-2",
          data: JSON.stringify({ targetDate: "2026-10-04T00:00:00.000Z" }),
        } as any;

        await aggregateDailyMetricsJob(mockJob);

        const expectedStartOfDay = new Date(Date.UTC(2026, 9, 4, 0, 0, 0, 0));
        expect(upsertSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { metricDate: expectedStartOfDay },
          })
        );
      });

      it("defaults to yesterday UTC when no date or job payload is provided", async () => {
        vi.spyOn(prisma.user, "count").mockResolvedValue(10);
        vi.spyOn(prisma.quote, "count").mockResolvedValue(0);
        vi.spyOn(prisma.like, "count").mockResolvedValue(0);
        vi.spyOn(prisma.repost, "count").mockResolvedValue(0);
        vi.spyOn(prisma.bookmark, "count").mockResolvedValue(0);
        vi.spyOn(prisma.follow, "count").mockResolvedValue(0);
        vi.spyOn(prisma.quote, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.like, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.repost, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.follow, "findMany").mockResolvedValue([] as any);
        vi.spyOn(prisma.bookmark, "findMany").mockResolvedValue([] as any);

        const upsertSpy = vi
          .spyOn(prisma.dailyMetric, "upsert")
          .mockResolvedValue({} as any);

        const beforeNow = new Date();
        await aggregateDailyMetricsJob();

        const expectedYesterday = new Date(
          Date.UTC(
            beforeNow.getUTCFullYear(),
            beforeNow.getUTCMonth(),
            beforeNow.getUTCDate() - 1,
            0,
            0,
            0,
            0
          )
        );

        expect(upsertSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { metricDate: expectedYesterday },
          })
        );
      });

      it("propagates database errors cleanly", async () => {
        vi.spyOn(prisma.user, "count").mockRejectedValueOnce(
          new Error("DB connection failure")
        );

        await expect(aggregateDailyMetricsJob(new Date())).rejects.toThrow(
          "DB connection failure"
        );
      });
    });

    describe("startAnalyticsWorker and stopAnalyticsWorker", () => {
      it("creates worker on 'analytics-queue' and closes cleanly", async () => {
        const mockWorker = {
          close: vi.fn().mockResolvedValue(undefined),
        };
        const createWorkerSpy = vi
          .spyOn(bullmqModule, "createWorker")
          .mockReturnValue(mockWorker as any);

        const worker1 = startAnalyticsWorker();
        expect(createWorkerSpy).toHaveBeenCalledWith(
          ANALYTICS_QUEUE_NAME,
          aggregateDailyMetricsJob,
          undefined
        );
        expect(worker1).toBe(mockWorker);

        // Subsequent call reuses singleton
        const worker2 = startAnalyticsWorker();
        expect(worker2).toBe(mockWorker);
        expect(createWorkerSpy).toHaveBeenCalledTimes(1);

        // Stop worker
        await stopAnalyticsWorker();
        expect(mockWorker.close).toHaveBeenCalledTimes(1);

        // Calling start after stop creates fresh worker
        startAnalyticsWorker();
        expect(createWorkerSpy).toHaveBeenCalledTimes(2);
      });
    });
  });
});
