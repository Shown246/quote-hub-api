import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  processNotificationJob,
  startNotificationWorker,
  stopNotificationWorker,
} from "../../../src/workers/notifications.worker";
import { notificationService } from "../../../src/modules/notifications/services/notification.service";
import * as bullmqModule from "../../../src/infrastructure/queue/bullmq";
import { NotificationType } from "@prisma/client";

describe("Notifications Worker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("processNotificationJob", () => {
    it("handles LikeCreated job correctly", async () => {
      const createSpy = vi
        .spyOn(notificationService, "createNotification")
        .mockResolvedValueOnce({
          id: "notif-1",
          userId: "user-author",
          actorId: "user-liker",
          type: NotificationType.LIKE,
          entityId: "quote-1",
          readAt: null,
          createdAt: new Date(),
        });

      const mockJob = {
        name: "LikeCreated",
        id: "job-1",
        data: {
          actorId: "user-liker",
          quoteId: "quote-1",
          recipientId: "user-author",
        },
      } as any;

      const result = await processNotificationJob(mockJob);

      expect(createSpy).toHaveBeenCalledWith(
        "user-author",
        "user-liker",
        NotificationType.LIKE,
        "quote-1"
      );
      expect(result).toBeDefined();
    });

    it("handles RepostCreated job correctly", async () => {
      const createSpy = vi
        .spyOn(notificationService, "createNotification")
        .mockResolvedValueOnce({
          id: "notif-2",
          userId: "user-author",
          actorId: "user-reposter",
          type: NotificationType.REPOST,
          entityId: "quote-1",
          readAt: null,
          createdAt: new Date(),
        });

      const mockJob = {
        name: "RepostCreated",
        id: "job-2",
        data: {
          actorId: "user-reposter",
          quoteId: "quote-1",
          recipientId: "user-author",
        },
      } as any;

      const result = await processNotificationJob(mockJob);

      expect(createSpy).toHaveBeenCalledWith(
        "user-author",
        "user-reposter",
        NotificationType.REPOST,
        "quote-1"
      );
      expect(result).toBeDefined();
    });

    it("handles FollowCreated job correctly", async () => {
      const createSpy = vi
        .spyOn(notificationService, "createNotification")
        .mockResolvedValueOnce({
          id: "notif-3",
          userId: "user-followed",
          actorId: "user-follower",
          type: NotificationType.FOLLOW,
          entityId: "user-followed",
          readAt: null,
          createdAt: new Date(),
        });

      const mockJob = {
        name: "FollowCreated",
        id: "job-3",
        data: {
          actorId: "user-follower",
          recipientId: "user-followed",
        },
      } as any;

      const result = await processNotificationJob(mockJob);

      expect(createSpy).toHaveBeenCalledWith(
        "user-followed",
        "user-follower",
        NotificationType.FOLLOW,
        "user-followed"
      );
      expect(result).toBeDefined();
    });

    it("handles stringified JSON payload defensively", async () => {
      const createSpy = vi
        .spyOn(notificationService, "createNotification")
        .mockResolvedValueOnce(null);

      const mockJob = {
        name: "LikeCreated",
        id: "job-4",
        data: JSON.stringify({
          actorId: "user-liker",
          quoteId: "quote-1",
          recipientId: "user-author",
        }),
      } as any;

      await processNotificationJob(mockJob);

      expect(createSpy).toHaveBeenCalledWith(
        "user-author",
        "user-liker",
        NotificationType.LIKE,
        "quote-1"
      );
    });

    it("returns null when actor is recipient (self-notification guard)", async () => {
      const createSpy = vi
        .spyOn(notificationService, "createNotification")
        .mockResolvedValueOnce(null);

      const mockJob = {
        name: "LikeCreated",
        id: "job-5",
        data: {
          actorId: "user-1",
          quoteId: "quote-1",
          recipientId: "user-1",
        },
      } as any;

      const result = await processNotificationJob(mockJob);

      expect(createSpy).toHaveBeenCalledWith(
        "user-1",
        "user-1",
        NotificationType.LIKE,
        "quote-1"
      );
      expect(result).toBeNull();
    });

    it("ignores unrecognized event types gracefully", async () => {
      const createSpy = vi.spyOn(notificationService, "createNotification");

      const mockJob = {
        name: "UnknownEvent",
        id: "job-6",
        data: {
          actorId: "u1",
          recipientId: "u2",
        },
      } as any;

      const result = await processNotificationJob(mockJob);

      expect(createSpy).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("returns null if required fields are missing", async () => {
      const createSpy = vi.spyOn(notificationService, "createNotification");

      const mockJob = {
        name: "LikeCreated",
        id: "job-7",
        data: {
          actorId: "u1",
          // missing recipientId & quoteId
        },
      } as any;

      const result = await processNotificationJob(mockJob);

      expect(createSpy).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe("startNotificationWorker and stopNotificationWorker", () => {
    it("creates worker on notifications-queue and closes worker on stop", async () => {
      const mockWorker = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      const createWorkerSpy = vi
        .spyOn(bullmqModule, "createWorker")
        .mockReturnValue(mockWorker as any);

      const worker = startNotificationWorker();
      expect(createWorkerSpy).toHaveBeenCalledWith(
        "notifications-queue",
        processNotificationJob,
        undefined
      );
      expect(worker).toBe(mockWorker);

      await stopNotificationWorker();
      expect(mockWorker.close).toHaveBeenCalled();
    });
  });
});
