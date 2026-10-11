import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cleanupDeletedUserJob,
  processUserCleanupJob,
  startUserCleanupWorker,
  stopUserCleanupWorker,
  USER_CLEANUP_QUEUE_NAME,
} from "../../../src/workers/user-cleanup.worker";
import { prisma } from "../../../src/infrastructure/database/prisma";
import * as bullmqModule from "../../../src/infrastructure/queue/bullmq";

describe("User Cleanup Worker", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await stopUserCleanupWorker();
  });

  describe("constants", () => {
    it("exports USER_CLEANUP_QUEUE_NAME as 'user-cleanup-queue'", () => {
      expect(USER_CLEANUP_QUEUE_NAME).toBe("user-cleanup-queue");
    });
  });

  describe("cleanupDeletedUserJob", () => {
    it("should invoke purge_deleted_user_data stored procedure", async () => {
      const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      const testUserId = "018f972b-5b3a-7d4e-8fa1-0123456789ab";

      await cleanupDeletedUserJob(testUserId);

      expect(spy).toHaveBeenCalled();
    });

    it("re-throws error if prisma.$executeRaw fails", async () => {
      vi.spyOn(prisma, "$executeRaw").mockRejectedValueOnce(
        new Error("Database connection error")
      );

      await expect(
        cleanupDeletedUserJob("018f972b-5b3a-7d4e-8fa1-0123456789ab")
      ).rejects.toThrow("Database connection error");
    });
  });

  describe("processUserCleanupJob", () => {
    it("extracts userId from job.data.userId and invokes cleanupDeletedUserJob", async () => {
      const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      const mockJob = {
        id: "job-1",
        name: "UserDeleted",
        data: {
          userId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
        },
      } as any;

      await processUserCleanupJob(mockJob);

      expect(spy).toHaveBeenCalled();
    });

    it("extracts userId from job.data.id fallback", async () => {
      const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      const mockJob = {
        id: "job-2",
        name: "UserDeleted",
        data: {
          id: "018f972b-5b3a-7d4e-8fa1-0123456789ac",
        },
      } as any;

      await processUserCleanupJob(mockJob);

      expect(spy).toHaveBeenCalled();
    });

    it("extracts userId from job.data.aggregateId fallback", async () => {
      const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      const mockJob = {
        id: "job-3",
        name: "UserDeleted",
        data: {
          aggregateId: "018f972b-5b3a-7d4e-8fa1-0123456789ad",
        },
      } as any;

      await processUserCleanupJob(mockJob);

      expect(spy).toHaveBeenCalled();
    });

    it("extracts userId from job.data.user_id fallback", async () => {
      const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      const mockJob = {
        id: "job-4",
        name: "UserDeleted",
        data: {
          user_id: "018f972b-5b3a-7d4e-8fa1-0123456789ae",
        },
      } as any;

      await processUserCleanupJob(mockJob);

      expect(spy).toHaveBeenCalled();
    });

    it("extracts userId from JSON-serialized string payload", async () => {
      const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      const mockJob = {
        id: "job-5",
        name: "UserDeleted",
        data: JSON.stringify({
          userId: "018f972b-5b3a-7d4e-8fa1-0123456789af",
        }),
      } as any;

      await processUserCleanupJob(mockJob);

      expect(spy).toHaveBeenCalled();
    });

    it("extracts userId from JSON string with aggregateId payload", async () => {
      const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      const mockJob = {
        id: "job-6",
        name: "UserDeleted",
        data: JSON.stringify({
          aggregateId: "018f972b-5b3a-7d4e-8fa1-0123456789b0",
        }),
      } as any;

      await processUserCleanupJob(mockJob);

      expect(spy).toHaveBeenCalled();
    });

    it("extracts userId when data is a raw string UUID", async () => {
      const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
      const mockJob = {
        id: "job-7",
        name: "UserDeleted",
        data: "018f972b-5b3a-7d4e-8fa1-0123456789b1",
      } as any;

      await processUserCleanupJob(mockJob);

      expect(spy).toHaveBeenCalled();
    });

    it("throws an error when userId cannot be extracted from payload", async () => {
      const mockJob = {
        id: "job-8",
        name: "UserDeleted",
        data: {},
      } as any;

      await expect(processUserCleanupJob(mockJob)).rejects.toThrow(
        "Missing userId in user cleanup job payload"
      );
    });

    it("re-throws error when cleanupDeletedUserJob fails during processing", async () => {
      vi.spyOn(prisma, "$executeRaw").mockRejectedValueOnce(
        new Error("Postgres stored proc error")
      );
      const mockJob = {
        id: "job-9",
        name: "UserDeleted",
        data: {
          userId: "018f972b-5b3a-7d4e-8fa1-0123456789b2",
        },
      } as any;

      await expect(processUserCleanupJob(mockJob)).rejects.toThrow(
        "Postgres stored proc error"
      );
    });
  });

  describe("startUserCleanupWorker and stopUserCleanupWorker", () => {
    it("creates worker on user-cleanup-queue and closes worker on stop", async () => {
      const mockWorker = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      const createWorkerSpy = vi
        .spyOn(bullmqModule, "createWorker")
        .mockReturnValue(mockWorker as any);

      const worker1 = startUserCleanupWorker();
      expect(createWorkerSpy).toHaveBeenCalledWith(
        "user-cleanup-queue",
        processUserCleanupJob,
        undefined
      );
      expect(worker1).toBe(mockWorker);

      // Calling startUserCleanupWorker again returns the same singleton
      const worker2 = startUserCleanupWorker();
      expect(worker2).toBe(mockWorker);
      expect(createWorkerSpy).toHaveBeenCalledTimes(1);

      // Stopping closes the worker and resets singleton
      await stopUserCleanupWorker();
      expect(mockWorker.close).toHaveBeenCalledTimes(1);

      // Starting again creates a new worker
      startUserCleanupWorker();
      expect(createWorkerSpy).toHaveBeenCalledTimes(2);
    });
  });
});
