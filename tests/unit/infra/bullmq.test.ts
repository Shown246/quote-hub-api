import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getQueue,
  createWorker,
  closeQueue,
  closeAllQueues,
  closeAllWorkers,
  closeAll,
  DEFAULT_JOB_OPTIONS,
  setDefaultConnectionFactory,
} from "../../../src/infrastructure/queue/bullmq";
import { logger } from "../../../src/infrastructure/logging/logger";

describe("BullMQ Queue Factory", () => {
  afterEach(async () => {
    await closeAll();
    setDefaultConnectionFactory(null);
    vi.clearAllMocks();
  });

  it("should initialize a named queue with exponential backoff retry default", () => {
    const queue = getQueue("test-queue");
    expect(queue).toBeDefined();
    expect(queue.name).toBe("test-queue");
    expect(queue.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
    expect(queue.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: true,
    });
  });

  it("should reuse the existing queue instance for the same queue name", () => {
    const queue1 = getQueue("reused-queue");
    const queue2 = getQueue("reused-queue");
    expect(queue1).toBe(queue2);
  });

  it("should return cached queue instance when called multiple times even if opts are supplied", () => {
    const queue1 = getQueue("opts-cache-queue", { defaultJobOptions: { attempts: 4 } });
    const queue2 = getQueue("opts-cache-queue", { defaultJobOptions: { attempts: 10 } });
    expect(queue1).toBe(queue2);
  });

  it("should merge partial defaultJobOptions while preserving default backoff and removeOnComplete", () => {
    const queue = getQueue("custom-job-opts-queue", {
      defaultJobOptions: { attempts: 5 },
    });
    expect(queue.defaultJobOptions).toEqual({
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: true,
    });
  });

  it("should create a worker associated with the specified queue and processor", async () => {
    const processor = vi.fn();
    const worker = createWorker("test-worker-queue", processor);

    expect(worker).toBeDefined();
    expect(worker.name).toBe("test-worker-queue");
  });

  it("should cleanly close all queues and clear cache", async () => {
    const queue1 = getQueue("queue-1");
    const queue2 = getQueue("queue-2");

    await closeAllQueues();

    // After closeAllQueues, calling getQueue should return a new instance
    const newQueue1 = getQueue("queue-1");
    expect(newQueue1).not.toBe(queue1);
  });

  it("should cleanly close all workers", async () => {
    const worker1 = createWorker("worker-queue-1", async () => {});
    const worker2 = createWorker("worker-queue-2", async () => {});

    await expect(closeAllWorkers()).resolves.toBeUndefined();
  });

  it("should remove closed worker from tracking", async () => {
    const worker = createWorker("close-event-worker", async () => {});
    await worker.close();
    await expect(closeAllWorkers()).resolves.toBeUndefined();
  });

  it("should support custom connection injection via connection factory", () => {
    const mockFactory = vi.fn().mockReturnValue({
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    });
    setDefaultConnectionFactory(mockFactory);

    const queue = getQueue("custom-connection-queue");
    expect(queue).toBeDefined();
    expect(mockFactory).toHaveBeenCalled();
  });

  it("should close an individual named queue via closeQueue", async () => {
    const queue1 = getQueue("single-close-queue");
    await closeQueue("single-close-queue");

    const queue2 = getQueue("single-close-queue");
    expect(queue2).not.toBe(queue1);
  });

  it("should log warnings when error events are emitted on queue or worker", () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const testError = new Error("BullMQ simulated error");

    const queue = getQueue("error-test-queue");
    expect(() => {
      queue.emit("error", testError);
    }).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: testError }),
      expect.stringContaining("BullMQ queue connection error")
    );

    const worker = createWorker("error-test-worker", vi.fn());
    expect(() => {
      worker.emit("error", testError);
    }).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: testError }),
      expect.stringContaining("BullMQ worker connection error")
    );
  });
});
