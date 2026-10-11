import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserService } from "../../../../src/modules/users/services/user.service";
import { prisma } from "../../../../src/infrastructure/database/prisma";
import * as outboxModule from "../../../../src/infrastructure/queue/outbox";

describe("UserService.confirmAvatarUpload", () => {
  let userService: UserService;

  beforeEach(() => {
    userService = new UserService();
  });

  it("rejects keys belonging to another user", async () => {
    const userId = "018f3a2c-1234-7000-8000-000000000001";
    const foreignKey = "uploads/avatars/018f3a2c-9999-7000-8000-999999999999/12345.webp";
    await expect(userService.confirmAvatarUpload(userId, foreignKey)).rejects.toThrow(
      "Object key does not belong to authenticated user"
    );
  });

  it("stages AvatarUploaded outbox event when key is valid and owned", async () => {
    const userId = "018f3a2c-1234-7000-8000-000000000001";
    const ownKey = `uploads/avatars/${userId}/1712000000.png`;

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
    const stageSpy = vi.spyOn(outboxModule, "stageOutboxEvent").mockResolvedValueOnce({} as any);

    const result = await userService.confirmAvatarUpload(userId, ownKey);
    expect(result.key).toBe(ownKey);
    expect(stageSpy).toHaveBeenCalledWith(
      expect.anything(),
      "AvatarUploaded",
      "Media",
      userId,
      { userId, tempKey: ownKey }
    );
  });
});
