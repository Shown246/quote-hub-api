import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import RedisMock from "ioredis-mock";
import { createRateLimiter } from "../../../src/middleware/rate-limit";
import { errorHandler } from "../../../src/middleware/error-handler";

describe("createRateLimiter middleware", () => {
  describe("basic limiting with in-memory fallback", () => {
    const app = express();
    const limiter = createRateLimiter({ max: 2, windowSeconds: 60, keyPrefix: "test-limit" });
    app.get("/limited", limiter, (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    it("should permit requests within limit and return 429 when exceeded", async () => {
      await request(app).get("/limited").expect(200);
      await request(app).get("/limited").expect(200);
      const res = await request(app).get("/limited");
      expect(res.status).toBe(429);
      expect(res.headers["retry-after"]).toBeDefined();
      expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(res.body.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(res.body.detail).toBe("Rate limit exceeded");
    });
  });

  describe("token bucket algorithm refill dynamics", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should refill tokens proportionally over elapsed time", async () => {
      const app = express();
      // max 2 tokens, window 60s -> fillRate = 2/60 = 1 token every 30s
      const limiter = createRateLimiter({ max: 2, windowSeconds: 60, keyPrefix: "refill-test" });
      app.get("/refill", limiter, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      // Consume both tokens
      await request(app).get("/refill").expect(200);
      await request(app).get("/refill").expect(200);

      // 3rd request fails -> 0 tokens remaining
      const blocked1 = await request(app).get("/refill");
      expect(blocked1.status).toBe(429);
      // Need 1 token, at 1 token / 30s -> retry-after = 30s
      expect(blocked1.headers["retry-after"]).toBe("30");

      // Advance by 30 seconds -> 1 token refilled
      vi.advanceTimersByTime(30000);

      // 4th request succeeds with refilled token
      const res4 = await request(app).get("/refill");
      expect(res4.status).toBe(200);

      // 5th request fails again immediately
      const blocked2 = await request(app).get("/refill");
      expect(blocked2.status).toBe(429);
    });
  });

  describe("compound key derivation (IP + Authenticated User ID)", () => {
    it("should partition rate limits by compound ip and user id", async () => {
      const app = express();
      const limiter = createRateLimiter({ max: 1, windowSeconds: 60, keyPrefix: "compound-limit" });

      app.get(
        "/compound",
        (req: Request, _res: Response, next) => {
          const testIp = req.headers["x-test-ip"];
          if (testIp) {
            Object.defineProperty(req, "ip", { value: testIp, configurable: true });
          }
          const userId = req.headers["x-test-user-id"];
          if (userId) {
            (req as any).user = { id: userId };
          }
          next();
        },
        limiter,
        (_req: Request, res: Response) => res.json({ success: true })
      );
      app.use(errorHandler);

      // 1. User A on IP 1 -> succeeds
      await request(app)
        .get("/compound")
        .set("x-test-ip", "10.0.0.1")
        .set("x-test-user-id", "user_A")
        .expect(200);

      // 2. User A on IP 1 again -> blocked (exhausted)
      const userABlocked = await request(app)
        .get("/compound")
        .set("x-test-ip", "10.0.0.1")
        .set("x-test-user-id", "user_A");
      expect(userABlocked.status).toBe(429);

      // 3. User B on IP 1 -> succeeds (different user on same IP)
      await request(app)
        .get("/compound")
        .set("x-test-ip", "10.0.0.1")
        .set("x-test-user-id", "user_B")
        .expect(200);

      // 4. User A on IP 2 -> succeeds (same user on different IP)
      await request(app)
        .get("/compound")
        .set("x-test-ip", "10.0.0.2")
        .set("x-test-user-id", "user_A")
        .expect(200);

      // 5. Unauthenticated client on IP 1 -> succeeds (no user on IP 1)
      await request(app)
        .get("/compound")
        .set("x-test-ip", "10.0.0.1")
        .expect(200);
    });

    it("should fall back to 'unknown' when req.ip is unavailable", async () => {
      const app = express();
      const limiter = createRateLimiter({ max: 1, windowSeconds: 60, keyPrefix: "no-ip-limit" });

      app.get(
        "/no-ip",
        (req: Request, _res: Response, next) => {
          delete (req as any).user;
          Object.defineProperty(req, "ip", { value: undefined, configurable: true });
          next();
        },
        limiter,
        (_req: Request, res: Response) => res.json({ ok: true })
      );
      app.use(errorHandler);

      await request(app).get("/no-ip").expect(200);
      const blocked = await request(app).get("/no-ip");
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("redis backed rate limiting and lazy connection handling", () => {
    it("should execute redis token-bucket EVAL script and enforce limits", async () => {
      const redisMock = new RedisMock() as any;
      const app = express();
      const limiter = createRateLimiter({
        max: 2,
        windowSeconds: 30,
        keyPrefix: "redis-limit",
        redisClient: redisMock,
      });

      app.get("/redis-endpoint", limiter, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      await request(app).get("/redis-endpoint").expect(200);
      await request(app).get("/redis-endpoint").expect(200);

      const res = await request(app).get("/redis-endpoint");
      expect(res.status).toBe(429);
      expect(res.headers["retry-after"]).toBeDefined();
      expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(res.body.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("should attempt redis when client status is 'wait' (lazyConnect)", async () => {
      const redisMock = new RedisMock() as any;
      // Simulate lazyConnect initial status
      Object.defineProperty(redisMock, "status", { value: "wait", writable: true });
      const evalSpy = vi.spyOn(redisMock, "eval");

      const app = express();
      const limiter = createRateLimiter({
        max: 2,
        windowSeconds: 60,
        keyPrefix: "lazy-redis",
        redisClient: redisMock,
      });

      app.get("/lazy", limiter, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      await request(app).get("/lazy").expect(200);
      expect(evalSpy).toHaveBeenCalled();
    });

    it("should fall back gracefully to in-memory store when redis throws", async () => {
      const redisMock = new RedisMock() as any;
      vi.spyOn(redisMock, "eval").mockRejectedValue(new Error("Redis connection failure"));

      const app = express();
      const limiter = createRateLimiter({
        max: 1,
        windowSeconds: 60,
        keyPrefix: "failing-redis",
        redisClient: redisMock,
      });

      app.get("/redis-fail", limiter, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      // 1st request -> succeeds via in-memory fallback
      await request(app).get("/redis-fail").expect(200);

      // 2nd request -> rate limited via fallback without throwing 500
      const blocked = await request(app).get("/redis-fail");
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });
});
