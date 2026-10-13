import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrSetCache, invalidateCache, invalidateByPattern } from "../../../src/infrastructure/redis/cache";
import { redis } from "../../../src/infrastructure/redis/redis";

describe("Centralized Cache Utility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getOrSetCache", () => {
    it("should return cached data on cache hit without calling fetcher", async () => {
      const mockData = { id: "123", name: "test" };
      vi.spyOn(redis, "get").mockResolvedValueOnce(JSON.stringify(mockData));
      const fetcher = vi.fn();

      const result = await getOrSetCache("test:key", 60, fetcher);

      expect(result).toEqual(mockData);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("should call fetcher and set cache with TTL on cache miss", async () => {
      const freshData = { id: "456", name: "fresh" };
      vi.spyOn(redis, "get").mockResolvedValueOnce(null);
      const setSpy = vi.spyOn(redis, "set").mockResolvedValueOnce("OK" as any);
      const fetcher = vi.fn().mockResolvedValueOnce(freshData);

      const result = await getOrSetCache("test:key", 120, fetcher);

      expect(result).toEqual(freshData);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(setSpy).toHaveBeenCalledWith("test:key", JSON.stringify(freshData), "EX", 120);
    });

    it("should fall back transparently to fetcher when Redis throws an error", async () => {
      const freshData = { id: "789", name: "fallback" };
      vi.spyOn(redis, "get").mockRejectedValueOnce(new Error("Redis connection lost"));
      const fetcher = vi.fn().mockResolvedValueOnce(freshData);

      const result = await getOrSetCache("test:error", 60, fetcher);

      expect(result).toEqual(freshData);
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it("should not write to Redis cache when fetcher returns null or undefined", async () => {
      vi.spyOn(redis, "get").mockResolvedValueOnce(null);
      const setSpy = vi.spyOn(redis, "set");
      const nullFetcher = vi.fn().mockResolvedValueOnce(null);

      const nullResult = await getOrSetCache("test:null", 60, nullFetcher);
      expect(nullResult).toBeNull();
      expect(nullFetcher).toHaveBeenCalledOnce();
      expect(setSpy).not.toHaveBeenCalled();

      vi.spyOn(redis, "get").mockResolvedValueOnce(null);
      const undefFetcher = vi.fn().mockResolvedValueOnce(undefined);
      const undefResult = await getOrSetCache("test:undefined", 60, undefFetcher);
      expect(undefResult).toBeUndefined();
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe("invalidateCache", () => {
    it("should delete specified keys from Redis", async () => {
      const delSpy = vi.spyOn(redis, "del").mockResolvedValueOnce(2 as any);

      await invalidateCache("key:1", "key:2");

      expect(delSpy).toHaveBeenCalledWith("key:1", "key:2");
    });

    it("should do nothing if no keys are provided", async () => {
      const delSpy = vi.spyOn(redis, "del");

      await invalidateCache();

      expect(delSpy).not.toHaveBeenCalled();
    });
  });

  describe("invalidateByPattern", () => {
    it("should scan and delete matching keys", async () => {
      vi.spyOn(redis, "scan")
        .mockResolvedValueOnce(["10", ["match:1", "match:2"]])
        .mockResolvedValueOnce(["0", ["match:3"]]);
      const delSpy = vi.spyOn(redis, "del").mockResolvedValue(1 as any);

      await invalidateByPattern("match:*");

      expect(delSpy).toHaveBeenCalledWith("match:1", "match:2");
      expect(delSpy).toHaveBeenCalledWith("match:3");
    });
  });
});
