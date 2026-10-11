import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startAllWorkers,
  stopAllWorkers,
  areWorkersRunning,
} from "../../../src/workers/runner";
import * as outboxWorkerModule from "../../../src/workers/outbox.worker";
import * as notificationsWorkerModule from "../../../src/workers/notifications.worker";
import * as mediaWorkerModule from "../../../src/workers/media.worker";
import * as trendingWorkerModule from "../../../src/workers/trending.worker";
import * as analyticsWorkerModule from "../../../src/workers/analytics.worker";
import * as userCleanupWorkerModule from "../../../src/workers/user-cleanup.worker";
import * as bullmqModule from "../../../src/infrastructure/queue/bullmq";

describe("Worker Runner Orchestrator", () => {
  let mockStopOutbox: ReturnType<typeof vi.fn>;
  let mockTrendingQueue: { add: ReturnType<typeof vi.fn> };
  let mockAnalyticsQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.restoreAllMocks();

    mockStopOutbox = vi.fn();
    vi.spyOn(outboxWorkerModule, "startOutboxWorker").mockReturnValue(mockStopOutbox as any);

    vi.spyOn(notificationsWorkerModule, "startNotificationWorker").mockReturnValue({} as any);
    vi.spyOn(notificationsWorkerModule, "stopNotificationWorker").mockResolvedValue(undefined as any);

    vi.spyOn(mediaWorkerModule, "startMediaWorker").mockReturnValue({} as any);
    vi.spyOn(mediaWorkerModule, "stopMediaWorker").mockResolvedValue(undefined as any);

    vi.spyOn(trendingWorkerModule, "startTrendingWorker").mockReturnValue({} as any);
    vi.spyOn(trendingWorkerModule, "stopTrendingWorker").mockResolvedValue(undefined as any);

    vi.spyOn(analyticsWorkerModule, "startAnalyticsWorker").mockReturnValue({} as any);
    vi.spyOn(analyticsWorkerModule, "stopAnalyticsWorker").mockResolvedValue(undefined as any);

    vi.spyOn(userCleanupWorkerModule, "startUserCleanupWorker").mockReturnValue({} as any);
    vi.spyOn(userCleanupWorkerModule, "stopUserCleanupWorker").mockResolvedValue(undefined as any);

    mockTrendingQueue = {
      add: vi.fn().mockResolvedValue({ id: "trending-repeatable-job" }),
    };
    mockAnalyticsQueue = {
      add: vi.fn().mockResolvedValue({ id: "analytics-repeatable-job" }),
    };

    vi.spyOn(bullmqModule, "getQueue").mockImplementation((queueName: string) => {
      if (queueName === trendingWorkerModule.TRENDING_QUEUE_NAME) {
        return mockTrendingQueue as any;
      }
      if (queueName === analyticsWorkerModule.ANALYTICS_QUEUE_NAME) {
        return mockAnalyticsQueue as any;
      }
      return { add: vi.fn() } as any;
    });
  });

  afterEach(async () => {
    await stopAllWorkers();
  });

  describe("startAllWorkers", () => {
    it("starts all background workers and registers repeatable jobs", async () => {
      await startAllWorkers();

      // 1. Verifies all 6 workers were started
      expect(outboxWorkerModule.startOutboxWorker).toHaveBeenCalledTimes(1);
      expect(notificationsWorkerModule.startNotificationWorker).toHaveBeenCalledTimes(1);
      expect(mediaWorkerModule.startMediaWorker).toHaveBeenCalledTimes(1);
      expect(trendingWorkerModule.startTrendingWorker).toHaveBeenCalledTimes(1);
      expect(analyticsWorkerModule.startAnalyticsWorker).toHaveBeenCalledTimes(1);
      expect(userCleanupWorkerModule.startUserCleanupWorker).toHaveBeenCalledTimes(1);

      // 2. Verifies repeatable jobs configured
      expect(mockTrendingQueue.add).toHaveBeenCalledWith(
        "recalculate-trending",
        {},
        {
          repeat: { pattern: "*/5 * * * *" },
        }
      );

      expect(mockAnalyticsQueue.add).toHaveBeenCalledWith(
        "aggregate-daily-metrics",
        {},
        {
          repeat: { pattern: "5 0 * * *" },
        }
      );

      // 3. Verifies running state
      expect(areWorkersRunning()).toBe(true);
    });
  });

  describe("stopAllWorkers", () => {
    it("stops all background workers cleanly and stops the outbox poller", async () => {
      await startAllWorkers();

      await stopAllWorkers();

      // 1. Verifies outbox poller stopped
      expect(mockStopOutbox).toHaveBeenCalledTimes(1);

      // 2. Verifies all queue workers stopped
      expect(notificationsWorkerModule.stopNotificationWorker).toHaveBeenCalledTimes(1);
      expect(mediaWorkerModule.stopMediaWorker).toHaveBeenCalledTimes(1);
      expect(trendingWorkerModule.stopTrendingWorker).toHaveBeenCalledTimes(1);
      expect(analyticsWorkerModule.stopAnalyticsWorker).toHaveBeenCalledTimes(1);
      expect(userCleanupWorkerModule.stopUserCleanupWorker).toHaveBeenCalledTimes(1);

      // 3. Verifies running state
      expect(areWorkersRunning()).toBe(false);
    });

    it("can be called safely when workers have not been started", async () => {
      await expect(stopAllWorkers()).resolves.not.toThrow();

      expect(mockStopOutbox).not.toHaveBeenCalled();
      expect(notificationsWorkerModule.stopNotificationWorker).toHaveBeenCalledTimes(1);
      expect(mediaWorkerModule.stopMediaWorker).toHaveBeenCalledTimes(1);
      expect(trendingWorkerModule.stopTrendingWorker).toHaveBeenCalledTimes(1);
      expect(analyticsWorkerModule.stopAnalyticsWorker).toHaveBeenCalledTimes(1);
      expect(userCleanupWorkerModule.stopUserCleanupWorker).toHaveBeenCalledTimes(1);
      expect(areWorkersRunning()).toBe(false);
    });
  });
});
