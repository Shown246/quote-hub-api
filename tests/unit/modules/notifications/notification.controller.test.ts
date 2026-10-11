import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationController } from "../../../../src/modules/notifications/controllers/notification.controller";
import { NotificationService } from "../../../../src/modules/notifications/services/notification.service";
import { Request, Response, NextFunction } from "express";
import {
  AuthenticationError,
  NotFoundError,
} from "../../../../src/shared/errors/problem-details";
import { NotificationType } from "@prisma/client";

describe("NotificationController", () => {
  let mockService: {
    listNotifications: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
    markAllAsRead: ReturnType<typeof vi.fn>;
  };
  let controller: NotificationController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockService = {
      listNotifications: vi.fn(),
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
    };
    controller = new NotificationController(
      mockService as unknown as NotificationService
    );

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe("listNotifications", () => {
    it("throws AuthenticationError when req.user is undefined", async () => {
      const req = { query: {} } as Request;

      await controller.listNotifications(req, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });

    it("parses limit query parameter and returns 200 with { data: notifications }", async () => {
      const mockNotifications = [
        {
          id: "notif-1",
          userId: "user-1",
          actorId: "actor-1",
          type: NotificationType.LIKE,
          entityId: "quote-1",
          readAt: null,
          createdAt: new Date(),
        },
      ];

      mockService.listNotifications.mockResolvedValueOnce(mockNotifications);

      const req = {
        user: { id: "user-1" },
        query: { limit: "15" },
      } as unknown as Request;

      await controller.listNotifications(req, res as Response, next);

      expect(mockService.listNotifications).toHaveBeenCalledWith("user-1", 15);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: mockNotifications });
      expect(next).not.toHaveBeenCalled();
    });

    it("defaults limit to 20 when limit query param is omitted", async () => {
      mockService.listNotifications.mockResolvedValueOnce([]);

      const req = {
        user: { id: "user-1" },
        query: {},
      } as unknown as Request;

      await controller.listNotifications(req, res as Response, next);

      expect(mockService.listNotifications).toHaveBeenCalledWith("user-1", 20);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: [] });
    });

    it("passes errors to next", async () => {
      const error = new Error("Database query failed");
      mockService.listNotifications.mockRejectedValueOnce(error);

      const req = {
        user: { id: "user-1" },
        query: {},
      } as unknown as Request;

      await controller.listNotifications(req, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("markAsRead", () => {
    it("throws AuthenticationError when req.user is missing", async () => {
      const req = { params: { id: "notif-1" } } as unknown as Request;

      await controller.markAsRead(req, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });

    it("calls service.markAsRead with user id and notification id and returns 200", async () => {
      const mockNotification = {
        id: "notif-1",
        userId: "user-1",
        actorId: "actor-1",
        type: NotificationType.LIKE,
        entityId: "quote-1",
        readAt: new Date(),
        createdAt: new Date(),
      };

      mockService.markAsRead.mockResolvedValueOnce(mockNotification);

      const req = {
        user: { id: "user-1" },
        params: { id: "notif-1" },
      } as unknown as Request;

      await controller.markAsRead(req, res as Response, next);

      expect(mockService.markAsRead).toHaveBeenCalledWith("user-1", "notif-1");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockNotification);
      expect(next).not.toHaveBeenCalled();
    });

    it("forwards NotFoundError to next", async () => {
      const error = new NotFoundError("Notification not found");
      mockService.markAsRead.mockRejectedValueOnce(error);

      const req = {
        user: { id: "user-1" },
        params: { id: "notif-missing" },
      } as unknown as Request;

      await controller.markAsRead(req, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe("markAllAsRead", () => {
    it("throws AuthenticationError when req.user is missing", async () => {
      const req = {} as Request;

      await controller.markAllAsRead(req, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
    });

    it("calls service.markAllAsRead and returns 200 with result count", async () => {
      mockService.markAllAsRead.mockResolvedValueOnce({ count: 4 });

      const req = {
        user: { id: "user-1" },
      } as unknown as Request;

      await controller.markAllAsRead(req, res as Response, next);

      expect(mockService.markAllAsRead).toHaveBeenCalledWith("user-1");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ count: 4 });
      expect(next).not.toHaveBeenCalled();
    });

    it("forwards errors to next", async () => {
      const error = new Error("DB Error");
      mockService.markAllAsRead.mockRejectedValueOnce(error);

      const req = {
        user: { id: "user-1" },
      } as unknown as Request;

      await controller.markAllAsRead(req, res as Response, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
