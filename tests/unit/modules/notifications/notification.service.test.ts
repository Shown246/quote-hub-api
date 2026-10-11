import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationService } from "../../../../src/modules/notifications/services/notification.service";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import { NotificationType } from "@prisma/client";
import { NotFoundError } from "../../../../src/shared/errors/problem-details";

describe("NotificationService", () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new NotificationService();
  });

  describe("createNotification", () => {
    it("createNotification should not create notification when actor is recipient", async () => {
      const spy = vi.spyOn(prisma.notification, "create");
      const result = await service.createNotification("user-1", "user-1", "LIKE", "quote-1");
      expect(spy).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("creates notification with generated UUIDv7 when actor is different from recipient", async () => {
      const mockNotification = {
        id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
        userId: "recipient-1",
        actorId: "actor-2",
        type: NotificationType.LIKE,
        entityId: "quote-1",
        readAt: null,
        createdAt: new Date(),
      };

      const spy = vi.spyOn(prisma.notification, "create").mockResolvedValueOnce(mockNotification);

      const result = await service.createNotification(
        "recipient-1",
        "actor-2",
        NotificationType.LIKE,
        "quote-1"
      );

      expect(spy).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          ),
          userId: "recipient-1",
          actorId: "actor-2",
          type: NotificationType.LIKE,
          entityId: "quote-1",
        }),
      });
      expect(result).toEqual(mockNotification);
    });
  });

  describe("listNotifications", () => {
    it("queries user notifications ordered by createdAt desc with default limit 20", async () => {
      const mockList = [
        {
          id: "notif-1",
          userId: "user-1",
          actorId: "actor-1",
          type: NotificationType.LIKE,
          entityId: "quote-1",
          readAt: null,
          createdAt: new Date(),
          actor: {
            id: "actor-1",
            username: "alice",
            displayName: "Alice",
            profileImageUrl: null,
          },
        },
      ];

      const spy = vi.spyOn(prisma.notification, "findMany").mockResolvedValueOnce(mockList as any);

      const result = await service.listNotifications("user-1");

      expect(spy).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          actor: {
            select: {
              id: true,
              username: true,
              displayName: true,
              profileImageUrl: true,
            },
          },
        },
      });
      expect(result).toEqual(mockList);
    });

    it("respects custom limit and clamps to max 100", async () => {
      const spy = vi.spyOn(prisma.notification, "findMany").mockResolvedValueOnce([]);

      await service.listNotifications("user-1", 150);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        })
      );
    });

    it("clamps limit to min 1 if zero or negative", async () => {
      const spy = vi.spyOn(prisma.notification, "findMany").mockResolvedValueOnce([]);

      await service.listNotifications("user-1", -5);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
        })
      );
    });
  });

  describe("markAsRead", () => {
    it("throws NotFoundError when notification does not exist or does not belong to user", async () => {
      vi.spyOn(prisma.notification, "findFirst").mockResolvedValueOnce(null);

      await expect(service.markAsRead("user-1", "notif-missing")).rejects.toThrow(
        NotFoundError
      );
    });

    it("returns notification without updating if already read", async () => {
      const existing = {
        id: "notif-1",
        userId: "user-1",
        actorId: "actor-1",
        type: NotificationType.LIKE,
        entityId: "quote-1",
        readAt: new Date("2026-10-01T00:00:00Z"),
        createdAt: new Date("2026-10-01T00:00:00Z"),
      };

      vi.spyOn(prisma.notification, "findFirst").mockResolvedValueOnce(existing);
      const updateSpy = vi.spyOn(prisma.notification, "update");

      const result = await service.markAsRead("user-1", "notif-1");

      expect(updateSpy).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it("updates readAt to current timestamp when notification is unread", async () => {
      const existing = {
        id: "notif-1",
        userId: "user-1",
        actorId: "actor-1",
        type: NotificationType.LIKE,
        entityId: "quote-1",
        readAt: null,
        createdAt: new Date(),
      };

      const updated = {
        ...existing,
        readAt: new Date(),
      };

      vi.spyOn(prisma.notification, "findFirst").mockResolvedValueOnce(existing);
      const updateSpy = vi.spyOn(prisma.notification, "update").mockResolvedValueOnce(updated);

      const result = await service.markAsRead("user-1", "notif-1");

      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "notif-1" },
        data: {
          readAt: expect.any(Date),
        },
      });
      expect(result).toEqual(updated);
    });
  });

  describe("markAllAsRead", () => {
    it("updates only unread notifications belonging to the requesting user", async () => {
      const spy = vi.spyOn(prisma.notification, "updateMany").mockResolvedValueOnce({
        count: 5,
      });

      const result = await service.markAllAsRead("user-1");

      expect(spy).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          readAt: null,
        },
        data: {
          readAt: expect.any(Date),
        },
      });
      expect(result).toEqual({ count: 5 });
    });
  });
});
