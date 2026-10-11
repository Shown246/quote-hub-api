import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "../../../../src/middleware/error-handler";
import { NotificationType } from "@prisma/client";

vi.mock("../../../../src/middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: "test-user-id" };
    next();
  },
}));

import { notificationRouter } from "../../../../src/modules/notifications/routes/notification.routes";
import { notificationService } from "../../../../src/modules/notifications/services/notification.service";

describe("Notification Routes Integration", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.restoreAllMocks();

    app = express();
    app.use(express.json());
    app.use("/api/v1/notifications", notificationRouter);
    app.use(errorHandler);
  });

  it("GET /api/v1/notifications calls listNotifications and returns 200", async () => {
    const mockList = [
      {
        id: "notif-1",
        userId: "test-user-id",
        actorId: "actor-1",
        type: NotificationType.LIKE,
        entityId: "quote-1",
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ];

    vi.spyOn(notificationService, "listNotifications").mockResolvedValueOnce(
      mockList as any
    );

    const res = await request(app)
      .get("/api/v1/notifications?limit=10")
      .expect(200);

    expect(res.body).toEqual({ data: mockList });
    expect(notificationService.listNotifications).toHaveBeenCalledWith(
      "test-user-id",
      10
    );
  });

  it("PATCH /api/v1/notifications/read-all routes to markAllAsRead (not to /:id/read)", async () => {
    const markAllSpy = vi
      .spyOn(notificationService, "markAllAsRead")
      .mockResolvedValueOnce({ count: 3 });

    const markSingleSpy = vi.spyOn(notificationService, "markAsRead");

    const res = await request(app)
      .patch("/api/v1/notifications/read-all")
      .expect(200);

    expect(res.body).toEqual({ count: 3 });
    expect(markAllSpy).toHaveBeenCalledWith("test-user-id");
    expect(markSingleSpy).not.toHaveBeenCalled();
  });

  it("PATCH /api/v1/notifications/:id/read routes to markAsRead with the specified id", async () => {
    const mockNotification = {
      id: "target-notif-uuid",
      userId: "test-user-id",
      actorId: "actor-1",
      type: NotificationType.REPOST,
      entityId: "quote-1",
      readAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const markSingleSpy = vi
      .spyOn(notificationService, "markAsRead")
      .mockResolvedValueOnce(mockNotification as any);

    const markAllSpy = vi.spyOn(notificationService, "markAllAsRead");

    const res = await request(app)
      .patch("/api/v1/notifications/target-notif-uuid/read")
      .expect(200);

    expect(res.body).toEqual(mockNotification);
    expect(markSingleSpy).toHaveBeenCalledWith(
      "test-user-id",
      "target-notif-uuid"
    );
    expect(markAllSpy).not.toHaveBeenCalled();
  });
});
