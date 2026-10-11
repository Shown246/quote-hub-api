import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { healthRouter } from "../../../src/app/routes/health.routes";
import * as db from "../../../src/infrastructure/database/prisma";

describe("Health Routes", () => {
  const app = express();
  app.use("/health", healthRouter);

  it("GET /health/live should return 200 with status alive", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it("GET /health/ready should return 200 when database is responsive", async () => {
    vi.spyOn(db, "pingDb").mockResolvedValueOnce(true);
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    expect(res.body.services.database).toBe("healthy");
  });

  it("GET /health/ready should return 503 when database fails", async () => {
    vi.spyOn(db, "pingDb").mockResolvedValueOnce(false);
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    expect(res.body.services.database).toBe("unhealthy");
  });
});
