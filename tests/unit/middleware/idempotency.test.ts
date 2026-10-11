import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { idempotencyMiddleware, computeRequestHash } from "../../../src/middleware/idempotency";
import { errorHandler } from "../../../src/middleware/error-handler";
import { prisma } from "../../../src/infrastructure/database/prisma";

describe("idempotencyMiddleware", () => {
  let app: express.Express;
  let handlerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    handlerSpy = vi.fn((req, res) => {
      res.status(201).json({ success: true, count: 1 });
    });

    app = express();
    app.use(express.json());
    // Attach authenticated user
    app.use((req, res, next) => {
      (req as any).user = { id: "user-123" };
      next();
    });

    app.post("/test", idempotencyMiddleware("POST /test"), (req, res, next) => {
      handlerSpy(req, res, next);
    });

    app.use(errorHandler);
  });

  it("should replay cached response when idempotency key is already COMPLETED", async () => {
    const payload = { hello: "world" };
    const hash = computeRequestHash(payload);

    vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce({
      id: "idem-1",
      userId: "user-123",
      key: "key-abc",
      endpoint: "POST /test",
      requestHash: hash,
      status: "COMPLETED",
      responseStatus: 201,
      responseBody: { success: true, count: 1 } as any,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-abc")
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.headers["x-cache-idempotent"]).toBe("HIT");
    expect(res.body).toEqual({ success: true, count: 1 });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("should return 409 Conflict when payload hash mismatches existing key", async () => {
    vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce({
      id: "idem-1",
      userId: "user-123",
      key: "key-abc",
      endpoint: "POST /test",
      requestHash: "different-hash-value-1234567890abcdef1234567890abcdef1234567890abcdef",
      status: "COMPLETED",
      responseStatus: 201,
      responseBody: { success: true, count: 1 } as any,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-abc")
      .send({ hello: "modified world" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.body.detail).toBe("Idempotency key payload mismatch");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("should return 409 Conflict when request with key is already in progress (PENDING)", async () => {
    const payload = { hello: "world" };
    const hash = computeRequestHash(payload);

    vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce({
      id: "idem-1",
      userId: "user-123",
      key: "key-abc",
      endpoint: "POST /test",
      requestHash: hash,
      status: "PENDING",
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-abc")
      .send(payload);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.body.detail).toBe("Request with this idempotency key is already in progress");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("should pass through normally when no Idempotency-Key header is present", async () => {
    const findUniqueSpy = vi.spyOn(prisma.idempotencyKey, "findUnique");
    const createSpy = vi.spyOn(prisma.idempotencyKey, "create");

    const res = await request(app)
      .post("/test")
      .send({ hello: "world" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, count: 1 });
    expect(res.headers["x-cache-idempotent"]).toBeUndefined();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(findUniqueSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("should create PENDING record and update to COMPLETED on successful response", async () => {
    const payload = { hello: "world" };
    const hash = computeRequestHash(payload);

    vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce(null);
    const createSpy = vi.spyOn(prisma.idempotencyKey, "create").mockResolvedValueOnce({
      id: "idem-uuid-v7",
      userId: "user-123",
      key: "key-new",
      endpoint: "POST /test",
      requestHash: hash,
      status: "PENDING",
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const updateSpy = vi.spyOn(prisma.idempotencyKey, "update").mockResolvedValueOnce({
      id: "idem-uuid-v7",
      userId: "user-123",
      key: "key-new",
      endpoint: "POST /test",
      requestHash: hash,
      status: "COMPLETED",
      responseStatus: 201,
      responseBody: { success: true, count: 1 } as any,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-new")
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, count: 1 });
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-123",
          key: "key-new",
          endpoint: "POST /test",
          requestHash: hash,
          status: "PENDING",
        }),
      })
    );

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          responseStatus: 201,
          responseBody: { success: true, count: 1 },
        }),
      })
    );
  });

  it("should handle concurrent insertion race condition (P2002) by returning 409 Conflict", async () => {
    vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce(null);
    const p2002Error: any = new Error("Unique constraint failed");
    p2002Error.code = "P2002";
    vi.spyOn(prisma.idempotencyKey, "create").mockRejectedValueOnce(p2002Error);

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-race")
      .send({ hello: "world" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.body.detail).toBe("Request with this idempotency key is already in progress");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("should normalize payload key order so differently-ordered keys produce a cache HIT", async () => {
    const payloadInDb = { a: 1, b: 2 };
    const hash = computeRequestHash(payloadInDb);

    vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce({
      id: "idem-1",
      userId: "user-123",
      key: "key-order",
      endpoint: "POST /test",
      requestHash: hash,
      status: "COMPLETED",
      responseStatus: 201,
      responseBody: { success: true, count: 1 } as any,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-order")
      .send({ b: 2, a: 1 });

    expect(res.status).toBe(201);
    expect(res.headers["x-cache-idempotent"]).toBe("HIT");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("should return 401 when request is unauthenticated (req.user missing)", async () => {
    const unauthApp = express();
    unauthApp.use(express.json());
    unauthApp.post("/test", idempotencyMiddleware("POST /test"), (req, res) => {
      res.status(201).json({ success: true });
    });
    unauthApp.use(errorHandler);

    const res = await request(unauthApp)
      .post("/test")
      .set("Idempotency-Key", "key-unauth")
      .send({ hello: "world" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("should mark key as FAILED when response is a 5xx error", async () => {
    const errApp = express();
    errApp.use(express.json());
    errApp.use((req, res, next) => {
      (req as any).user = { id: "user-123" };
      next();
    });
    errApp.post("/fail", idempotencyMiddleware("POST /fail"), (req, res, next) => {
      next(new Error("Server crash"));
    });
    errApp.use(errorHandler);

    vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce(null);
    vi.spyOn(prisma.idempotencyKey, "create").mockResolvedValueOnce({
      id: "idem-fail",
      userId: "user-123",
      key: "key-fail",
      endpoint: "POST /fail",
      requestHash: computeRequestHash({ hello: "fail" }),
      status: "PENDING",
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });
    const updateSpy = vi.spyOn(prisma.idempotencyKey, "update").mockResolvedValueOnce({
      id: "idem-fail",
      userId: "user-123",
      key: "key-fail",
      endpoint: "POST /fail",
      requestHash: computeRequestHash({ hello: "fail" }),
      status: "FAILED",
      responseStatus: 500,
      responseBody: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const res = await request(errApp)
      .post("/fail")
      .set("Idempotency-Key", "key-fail")
      .send({ hello: "fail" });

    expect(res.status).toBe(500);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          responseStatus: 500,
        }),
      })
    );
  });

  it("should allow retry when existing key has status FAILED", async () => {
    const payload = { hello: "retry" };
    const hash = computeRequestHash(payload);

    vi.spyOn(prisma.idempotencyKey, "findUnique").mockResolvedValueOnce({
      id: "idem-prev-failed",
      userId: "user-123",
      key: "key-retry",
      endpoint: "POST /test",
      requestHash: hash,
      status: "FAILED",
      responseStatus: 500,
      responseBody: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const updateSpy = vi.spyOn(prisma.idempotencyKey, "update")
      .mockResolvedValueOnce({
        id: "idem-prev-failed",
        userId: "user-123",
        key: "key-retry",
        endpoint: "POST /test",
        requestHash: hash,
        status: "PENDING",
        responseStatus: null,
        responseBody: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      })
      .mockResolvedValueOnce({
        id: "idem-prev-failed",
        userId: "user-123",
        key: "key-retry",
        endpoint: "POST /test",
        requestHash: hash,
        status: "COMPLETED",
        responseStatus: 201,
        responseBody: { success: true, count: 1 } as any,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      });

    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", "key-retry")
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, count: 1 });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  it("should return 400 ValidationError when Idempotency-Key length exceeds 255 characters", async () => {
    const longKey = "a".repeat(256);
    const res = await request(app)
      .post("/test")
      .set("Idempotency-Key", longKey)
      .send({ hello: "world" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.detail).toBe(
      "Idempotency-Key header must not exceed 255 characters"
    );
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
