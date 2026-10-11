import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";

describe("POST /api/v1/users/me/profile-image/confirm", () => {
  const app = createApp();
  const userId = "018f3a2c-1234-7000-8000-000000000001";

  beforeEach(() => {
    vi.spyOn(auth.api, "getSession").mockResolvedValue({
      session: { id: "sess-1", userId: "auth-1", token: "tok" },
      user: { id: "auth-1" },
    } as any);
    vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
      id: userId,
      authId: "auth-1",
      status: "ACTIVE",
      deletedAt: null,
    } as any);
  });

  it("returns 202 and stages outbox event upon valid key", async () => {
    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
    vi.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

    const key = `uploads/avatars/${userId}/1712000000.webp`;
    const res = await request(app)
      .post("/api/v1/users/me/profile-image/confirm")
      .send({ key });

    expect(res.status).toBe(202);
    expect(res.body.key).toBe(key);
  });
});
