import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pollAndDispatchOutbox,
  startOutboxWorker,
  resolveQueueName,
  QUEUES,
} from "../../../src/workers/outbox.worker";
import { prisma } from "../../../src/infrastructure/database/prisma";
import * as bullmqModule from "../../../src/infrastructure/queue/bullmq";
import { OutboxStatus } from "@prisma/client";

describe("Outbox Worker", () => {
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(bullmqModule, "getQueue").mockReturnValue(mockQueue as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveQueueName", () => {
    it("routes LikeCreated, RepostCreated, and FollowCreated to notifications-queue", () => {
      expect(resolveQueueName("LikeCreated", "Quote")).toBe(QUEUES.NOTIFICATIONS);
      expect(resolveQueueName("RepostCreated", "Quote")).toBe(QUEUES.NOTIFICATIONS);
      expect(resolveQueueName("FollowCreated", "User")).toBe(QUEUES.NOTIFICATIONS);
      expect(resolveQueueName("FollowCreated", "Follow")).toBe(QUEUES.NOTIFICATIONS);
    });

    it("routes UserDeleted to user-cleanup-queue", () => {
      expect(resolveQueueName("UserDeleted", "User")).toBe(QUEUES.USER_CLEANUP);
    });

    it("routes AvatarUploaded or aggregateType Media to media-queue", () => {
      expect(resolveQueueName("AvatarUploaded", "User")).toBe(QUEUES.MEDIA);
      expect(resolveQueueName("SomeMediaEvent", "Media")).toBe(QUEUES.MEDIA);
    });

    it("applies aggregateType fallbacks for Quote and User", () => {
      expect(resolveQueueName("UnknownQuoteEvent", "Quote")).toBe(QUEUES.NOTIFICATIONS);
      expect(resolveQueueName("UnknownUserEvent", "User")).toBe(QUEUES.USER_CLEANUP);
    });

    it("falls back to notifications-queue for unrecognized events and aggregates", () => {
      expect(resolveQueueName("UnknownEvent", "Other")).toBe(QUEUES.NOTIFICATIONS);
    });
  });

  describe("pollAndDispatchOutbox", () => {
    it("should return 0 when no pending outbox events exist", async () => {
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([]);
      const count = await pollAndDispatchOutbox();
      expect(count).toBe(0);
    });

    it("claims pending events and dispatches them to respective queues", async () => {
      const mockRawRows = [
        {
          id: "018f3a22-0001-7000-8000-000000000001",
          event_type: "LikeCreated",
          aggregate_type: "Quote",
          aggregate_id: "018f3a22-0000-7000-8000-000000000001",
          payload: { actorId: "user-1", recipientId: "user-2", quoteId: "q-1" },
          status: "PROCESSING",
          retry_count: 0,
        },
        {
          id: "018f3a22-0002-7000-8000-000000000002",
          event_type: "UserDeleted",
          aggregate_type: "User",
          aggregate_id: "018f3a22-0000-7000-8000-000000000002",
          payload: { userId: "user-9" },
          status: "PROCESSING",
          retry_count: 0,
        },
      ];

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRawRows);
      const updateSpy = vi.spyOn(prisma.outboxEvent, "update").mockResolvedValue({} as any);

      const count = await pollAndDispatchOutbox(20);

      expect(count).toBe(2);
      expect(bullmqModule.getQueue).toHaveBeenCalledWith(QUEUES.NOTIFICATIONS);
      expect(bullmqModule.getQueue).toHaveBeenCalledWith(QUEUES.USER_CLEANUP);

      expect(mockQueue.add).toHaveBeenCalledWith(
        "LikeCreated",
        { actorId: "user-1", recipientId: "user-2", quoteId: "q-1" },
        { jobId: "018f3a22-0001-7000-8000-000000000001" }
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        "UserDeleted",
        { userId: "user-9" },
        { jobId: "018f3a22-0002-7000-8000-000000000002" }
      );

      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "018f3a22-0001-7000-8000-000000000001" },
        data: expect.objectContaining({
          status: OutboxStatus.PUBLISHED,
          processedAt: expect.any(Date),
        }),
      });
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "018f3a22-0002-7000-8000-000000000002" },
        data: expect.objectContaining({
          status: OutboxStatus.PUBLISHED,
          processedAt: expect.any(Date),
        }),
      });
    });

    it("defensively handles camelCase row properties and stringified payload", async () => {
      const mockRawRows = [
        {
          id: "018f3a22-0003-7000-8000-000000000003",
          eventType: "FollowCreated",
          aggregateType: "User",
          aggregateId: "018f3a22-0000-7000-8000-000000000003",
          payload: JSON.stringify({ followerId: "u-1", followingId: "u-2" }),
          status: "PROCESSING",
          retryCount: 1,
        },
      ];

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRawRows);
      const updateSpy = vi.spyOn(prisma.outboxEvent, "update").mockResolvedValue({} as any);

      const count = await pollAndDispatchOutbox();

      expect(count).toBe(1);
      expect(bullmqModule.getQueue).toHaveBeenCalledWith(QUEUES.NOTIFICATIONS);
      expect(mockQueue.add).toHaveBeenCalledWith(
        "FollowCreated",
        { followerId: "u-1", followingId: "u-2" },
        { jobId: "018f3a22-0003-7000-8000-000000000003" }
      );
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "018f3a22-0003-7000-8000-000000000003" },
        data: expect.objectContaining({
          status: OutboxStatus.PUBLISHED,
          processedAt: expect.any(Date),
        }),
      });
    });

    it("reschedules event with exponential backoff on queue.add failure when retryCount < 4", async () => {
      const mockRawRows = [
        {
          id: "018f3a22-0004-7000-8000-000000000004",
          event_type: "LikeCreated",
          aggregate_type: "Quote",
          aggregate_id: "018f3a22-0000-7000-8000-000000000004",
          payload: { actorId: "u-1" },
          status: "PROCESSING",
          retry_count: 1,
        },
      ];

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRawRows);
      mockQueue.add.mockRejectedValueOnce(new Error("Redis connection timeout"));
      const updateSpy = vi.spyOn(prisma.outboxEvent, "update").mockResolvedValue({} as any);

      const startTime = Date.now();
      const count = await pollAndDispatchOutbox();

      expect(count).toBe(0);
      expect(updateSpy).toHaveBeenCalledTimes(1);

      const updateCall = updateSpy.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: "018f3a22-0004-7000-8000-000000000004" });
      expect(updateCall.data.status).toBe(OutboxStatus.PENDING);
      expect(updateCall.data.retryCount).toBe(2);
      expect(updateCall.data.lastError).toBe("Redis connection timeout");

      // retry_count 1 -> nextRetry 2 -> 2^2 * 1000 = 4000ms delay
      const scheduledAt = updateCall.data.scheduledAt as Date;
      expect(scheduledAt).toBeInstanceOf(Date);
      const delayMs = scheduledAt.getTime() - startTime;
      expect(delayMs).toBeGreaterThanOrEqual(3900);
      expect(delayMs).toBeLessThanOrEqual(4500);
    });

    it("marks event as FAILED when retryCount + 1 >= 5", async () => {
      const mockRawRows = [
        {
          id: "018f3a22-0005-7000-8000-000000000005",
          event_type: "AvatarUploaded",
          aggregate_type: "User",
          aggregate_id: "018f3a22-0000-7000-8000-000000000005",
          payload: { userId: "u-5" },
          status: "PROCESSING",
          retry_count: 4,
        },
      ];

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRawRows);
      mockQueue.add.mockRejectedValueOnce(new Error("Permanent queue failure"));
      const updateSpy = vi.spyOn(prisma.outboxEvent, "update").mockResolvedValue({} as any);

      const count = await pollAndDispatchOutbox();

      expect(count).toBe(0);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "018f3a22-0005-7000-8000-000000000005" },
        data: {
          status: OutboxStatus.FAILED,
          retryCount: 5,
          lastError: "Permanent queue failure",
        },
      });
    });

    it("continues processing remaining events when one event dispatch fails", async () => {
      const mockRawRows = [
        {
          id: "event-fail",
          event_type: "LikeCreated",
          aggregate_type: "Quote",
          aggregate_id: "quote-1",
          payload: { actorId: "u-1" },
          status: "PROCESSING",
          retry_count: 0,
        },
        {
          id: "event-succeed",
          event_type: "UserDeleted",
          aggregate_type: "User",
          aggregate_id: "user-2",
          payload: { userId: "user-2" },
          status: "PROCESSING",
          retry_count: 0,
        },
      ];

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRawRows);
      mockQueue.add
        .mockRejectedValueOnce(new Error("Transient Redis blip"))
        .mockResolvedValueOnce({ id: "job-2" });
      const updateSpy = vi.spyOn(prisma.outboxEvent, "update").mockResolvedValue({} as any);

      const count = await pollAndDispatchOutbox();

      expect(count).toBe(1);
      expect(updateSpy).toHaveBeenCalledTimes(2);

      // First call was backoff update for failed event
      expect(updateSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: "event-fail" },
          data: expect.objectContaining({
            status: OutboxStatus.PENDING,
            retryCount: 1,
            lastError: "Transient Redis blip",
          }),
        })
      );

      // Second call was publish update for successful event
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: "event-succeed" },
          data: expect.objectContaining({
            status: OutboxStatus.PUBLISHED,
          }),
        })
      );
    });
  });

  describe("startOutboxWorker", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("polls periodically and stops cleanly when stop function is called", async () => {
      const querySpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue([]);

      const stop = startOutboxWorker(1000);

      expect(querySpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(querySpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(querySpy).toHaveBeenCalledTimes(2);

      stop();

      await vi.advanceTimersByTimeAsync(2000);
      expect(querySpy).toHaveBeenCalledTimes(2);
    });
  });
});
