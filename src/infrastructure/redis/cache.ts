import { redis, safeRedisCall } from "./redis";
import { logger } from "../logging/logger";

/**
 * Retrieves a cached value from Redis or executes the fetcher function on miss.
 * Resilient against Redis outages: transparently falls back to fetcher if Redis errors.
 *
 * @param key Redis cache key
 * @param ttlSeconds Expiration time in seconds
 * @param fetcher Async supplier of fresh data on cache miss
 */
export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await safeRedisCall(
    async (client) => {
      const target = client ?? redis;
      const raw = await target.get(key);
      if (raw !== null && raw !== undefined) {
        try {
          return JSON.parse(raw) as T;
        } catch (e) {
          logger.warn(
            { err: e, key },
            "Failed to parse cached JSON, ignoring cache hit"
          );
          return null;
        }
      }
      return null;
    },
    async () => null
  );

  if (cached !== null && cached !== undefined) {
    return cached;
  }

  const fresh = await fetcher();

  if (fresh !== undefined && fresh !== null) {
    await safeRedisCall(
      async (client) => {
        const target = client ?? redis;
        await target.set(key, JSON.stringify(fresh), "EX", ttlSeconds);
      },
      async () => {}
    );
  }

  return fresh;
}

/**
 * Invalidates one or more specific cache keys from Redis.
 *
 * @param keys Cache keys to delete
 */
export async function invalidateCache(...keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  await safeRedisCall(
    async (client) => {
      const target = client ?? redis;
      await target.del(...keys);
    },
    async () => {}
  );
}

/**
 * Scans and invalidates all keys matching a glob pattern using SCAN to avoid blocking Redis.
 *
 * @param pattern Glob pattern (e.g. 'auth:user-sessions:*')
 */
export async function invalidateByPattern(pattern: string): Promise<void> {
  await safeRedisCall(
    async (client) => {
      const target = client ?? redis;
      let cursor = "0";
      do {
        const [nextCursor, matchedKeys] = await target.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100
        );
        cursor = nextCursor;
        if (matchedKeys && matchedKeys.length > 0) {
          await target.del(...matchedKeys);
        }
      } while (cursor !== "0");
    },
    async () => {}
  );
}
