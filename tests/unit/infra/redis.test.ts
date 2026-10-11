import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeRedisCall, redis, closeRedis } from "../../../src/infrastructure/redis/redis";
import { logger } from "../../../src/infrastructure/logging/logger";

describe("Redis Infrastructure & Fallback Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("safeRedisCall", () => {
    it("should return the result of op when operation succeeds", async () => {
      const mockOp = vi.fn().mockResolvedValue("redis-value");
      const mockFallback = vi.fn().mockResolvedValue("fallback-value");

      const result = await safeRedisCall(mockOp, mockFallback);

      expect(result).toBe("redis-value");
      expect(mockOp).toHaveBeenCalledWith(redis);
      expect(mockFallback).not.toHaveBeenCalled();
    });

    it("should return fallback value and log a warning when redis operation throws", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const redisError = new Error("Redis connection lost");
      const mockOp = vi.fn().mockRejectedValue(redisError);
      const mockFallback = vi.fn().mockResolvedValue("fallback-data");

      const result = await safeRedisCall(mockOp, mockFallback);

      expect(result).toBe("fallback-data");
      expect(mockOp).toHaveBeenCalledWith(redis);
      expect(mockFallback).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: redisError }),
        expect.stringContaining("Redis")
      );
    });

    it("should propagate error if fallback itself throws", async () => {
      const redisError = new Error("Redis timeout");
      const fallbackError = new Error("PostgreSQL query failed");
      const mockOp = vi.fn().mockRejectedValue(redisError);
      const mockFallback = vi.fn().mockRejectedValue(fallbackError);

      await expect(safeRedisCall(mockOp, mockFallback)).rejects.toThrow("PostgreSQL query failed");
    });
  });

  describe("redis client configuration and error handling", () => {
    it("should have lazyConnect enabled and resilience options configured", () => {
      expect(redis.options.lazyConnect).toBe(true);
      expect(redis.options.enableOfflineQueue).toBe(false);
      expect(redis.options.maxRetriesPerRequest).toBe(1);
    });

    it("should handle error events on redis client without throwing unhandled exceptions", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const testError = new Error("Simulated connection error");

      expect(() => {
        redis.emit("error", testError);
      }).not.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: testError }),
        expect.stringContaining("Redis client connection error")
      );
    });
  });

  describe("closeRedis", () => {
    it("should cleanly quit or disconnect redis client", async () => {
      const quitSpy = vi.spyOn(redis, "quit").mockResolvedValue("OK" as any);

      await expect(closeRedis()).resolves.toBeUndefined();
      expect(quitSpy).toHaveBeenCalled();
    });

    it("should disconnect if quit throws an error", async () => {
      vi.spyOn(redis, "quit").mockRejectedValue(new Error("Quit failed"));
      const disconnectSpy = vi.spyOn(redis, "disconnect").mockImplementation(() => {});

      await expect(closeRedis()).resolves.toBeUndefined();
      expect(disconnectSpy).toHaveBeenCalled();
    });
  });
});
