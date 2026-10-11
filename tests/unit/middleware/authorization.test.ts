import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { requireAdmin } from "../../../src/middleware/authorization";
import { errorHandler } from "../../../src/middleware/error-handler";
import type { User as DomainUser } from "@prisma/client";

describe("requireAdmin middleware", () => {
  const createApp = (userMock?: Partial<DomainUser> | null) => {
    const app = express();
    app.get(
      "/admin-only",
      (req, _res, next) => {
        if (userMock !== null && userMock !== undefined) {
          req.user = userMock as DomainUser;
        } else {
          delete req.user;
        }
        next();
      },
      requireAdmin,
      (_req, res) => res.json({ ok: true })
    );
    app.use(errorHandler);
    return app;
  };

  it("should return 401 AUTHENTICATION_REQUIRED when user is missing", async () => {
    const app = createApp(null);
    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    expect(res.body.detail).toBe("Authentication required");
  });

  it("should return 403 ADMIN_ACCESS_REQUIRED when user role is not ADMIN (e.g. USER)", async () => {
    const app = createApp({
      id: "user-1",
      role: "USER",
      status: "ACTIVE",
    });
    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    expect(res.body.detail).toBe("Administrator access required");
  });

  it("should return 403 ADMIN_ACCESS_REQUIRED when admin user is SUSPENDED", async () => {
    const app = createApp({
      id: "admin-1",
      role: "ADMIN",
      status: "SUSPENDED",
    });
    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    expect(res.body.detail).toBe("Administrator access required");
  });

  it("should return 403 ADMIN_ACCESS_REQUIRED when admin user status is DELETED", async () => {
    const app = createApp({
      id: "admin-1",
      role: "ADMIN",
      status: "DELETED",
    });
    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_ACCESS_REQUIRED");
    expect(res.body.detail).toBe("Administrator access required");
  });

  it("should return 200 and proceed to next handler when user is an ACTIVE ADMIN", async () => {
    const app = createApp({
      id: "admin-1",
      role: "ADMIN",
      status: "ACTIVE",
    });
    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
