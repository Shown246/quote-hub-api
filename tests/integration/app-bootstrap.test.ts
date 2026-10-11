import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { startServer } from "../../src/app/server";
import * as prismaModule from "../../src/infrastructure/database/prisma";

describe("Express App Bootstrap", () => {
  const app = createApp();

  it("should respond to GET /health/live with 200", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(res.body).toEqual(
      expect.objectContaining({
        status: "alive",
      })
    );
  });

  it("should return RFC 9457 404 for unknown routes", async () => {
    const res = await request(app).get("/api/v1/nonexistent");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body.code).toBe("NOT_FOUND");
    expect(res.body.status).toBe(404);
    expect(res.body.title).toBe("Resource not found");
  });

  it("should serve Swagger UI at /docs/", async () => {
    const res = await request(app).get("/docs/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
  });
  it("should preserve client-supplied x-request-id on 404", async () => {
    const res = await request(app)
      .get("/api/v1/nonexistent")
      .set("x-request-id", "custom-client-req-id-123");
    expect(res.status).toBe(404);
    expect(res.headers["x-request-id"]).toBe("custom-client-req-id-123");
    expect(res.body.instance).toBe("custom-client-req-id-123");
  });
});

describe("Server Entrypoint & Lifecycle", () => {
  it("should export startServer and listen on a port", async () => {
    const server = await startServer(0);
    expect(server.listening).toBe(true);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    expect(server.listening).toBe(false);
  });

  it("should handle graceful shutdown on SIGTERM", async () => {
    const disconnectDbSpy = vi
      .spyOn(prismaModule, "disconnectDb")
      .mockResolvedValueOnce(undefined);

    const server = await startServer(0);
    expect(server.listening).toBe(true);

    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => {
      expect(server.listening).toBe(false);
      expect(disconnectDbSpy).toHaveBeenCalled();
    });

    disconnectDbSpy.mockRestore();
  });

  it("should handle graceful shutdown on SIGINT", async () => {
    const disconnectDbSpy = vi
      .spyOn(prismaModule, "disconnectDb")
      .mockResolvedValueOnce(undefined);

    const server = await startServer(0);
    expect(server.listening).toBe(true);

    process.emit("SIGINT", "SIGINT");

    await vi.waitFor(() => {
      expect(server.listening).toBe(false);
      expect(disconnectDbSpy).toHaveBeenCalled();
    });

    disconnectDbSpy.mockRestore();
  });

  it("should handle database disconnect failure during shutdown gracefully", async () => {
    const disconnectDbSpy = vi
      .spyOn(prismaModule, "disconnectDb")
      .mockRejectedValueOnce(new Error("Db disconnect error"));

    const server = await startServer(0);
    expect(server.listening).toBe(true);

    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => {
      expect(server.listening).toBe(false);
      expect(disconnectDbSpy).toHaveBeenCalled();
    });

    disconnectDbSpy.mockRestore();
  });
});
