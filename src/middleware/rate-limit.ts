import type { Request, Response, NextFunction, RequestHandler } from "express";
import type Redis from "ioredis";
import { redis } from "../infrastructure/redis/redis";
import { RateLimitError } from "../shared/errors/problem-details";
import { logger } from "../infrastructure/logging/logger";

export interface RateLimiterOptions {
  max: number;
  windowSeconds: number;
  keyPrefix: string;
  redisClient?: Redis;
  isRouteLimiter?: boolean;
}

interface BucketEntry {
  tokens: number;
  lastRefill: number; // millisecond timestamp
}

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local windowSeconds = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

local fillRate = max / windowSeconds

local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1])
local lastRefill = tonumber(data[2])

if not tokens or not lastRefill then
    tokens = max
    lastRefill = nowMs
else
    local elapsedSeconds = math.max(0, (nowMs - lastRefill) / 1000)
    tokens = math.min(max, tokens + (elapsedSeconds * fillRate))
    lastRefill = nowMs
end

local allowed = 0
local retryAfter = 0

if tokens >= 1 then
    allowed = 1
    tokens = tokens - 1
    redis.call('HSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
    redis.call('EXPIRE', key, math.ceil(windowSeconds))
else
    allowed = 0
    local needed = 1 - tokens
    retryAfter = math.max(1, math.ceil(needed / fillRate))
    redis.call('HSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
    redis.call('EXPIRE', key, math.max(retryAfter, math.ceil(windowSeconds)))
end

return { allowed, tostring(tokens), retryAfter }
`;

let lastCleanup = 0;

/**
 * Periodically prunes stale entries from the in-memory fallback store
 * to bound memory usage without traversing O(N) on every request.
 */
function pruneStoreIfNeeded(
  store: Map<string, BucketEntry>,
  windowSeconds: number,
  now: number
): void {
  if (store.size > 1000 && now - lastCleanup > 60000) {
    lastCleanup = now;
    const maxStaleMs = windowSeconds * 1000 * 2;
    for (const [k, v] of store.entries()) {
      if (now - v.lastRefill > maxStaleMs) {
        store.delete(k);
      }
    }
  }
}

/**
 * In-memory token-bucket check used as a resilient fallback
 * during tests or when Redis is unreachable.
 */
function checkMemoryBucket(
  store: Map<string, BucketEntry>,
  key: string,
  max: number,
  windowSeconds: number,
  now: number
): { allowed: boolean; remainingTokens: number; retryAfter: number } {
  pruneStoreIfNeeded(store, windowSeconds, now);

  const fillRate = max / windowSeconds;
  let entry = store.get(key);

  if (!entry) {
    entry = { tokens: max, lastRefill: now };
    store.set(key, entry);
  } else {
    const elapsedSeconds = Math.max(0, (now - entry.lastRefill) / 1000);
    entry.tokens = Math.min(max, entry.tokens + elapsedSeconds * fillRate);
    entry.lastRefill = now;
  }

  if (entry.tokens >= 1) {
    entry.tokens -= 1;
    return {
      allowed: true,
      remainingTokens: entry.tokens,
      retryAfter: 0,
    };
  }

  const needed = 1 - entry.tokens;
  const retryAfter = Math.max(1, Math.ceil(needed / fillRate));
  return {
    allowed: false,
    remainingTokens: entry.tokens,
    retryAfter,
  };
}

/**
 * Executes the atomic token-bucket Lua script against Redis.
 */
async function checkRedis(
  client: Redis,
  key: string,
  max: number,
  windowSeconds: number,
  now: number
): Promise<{ allowed: boolean; remainingTokens: number; retryAfter: number }> {
  const result = (await client.eval(
    TOKEN_BUCKET_LUA,
    1,
    key,
    max.toString(),
    windowSeconds.toString(),
    now.toString()
  )) as [number, string, number];

  const allowed = Number(result[0]) === 1;
  const remainingTokens = parseFloat(result[1]);
  const retryAfter = Number(result[2]);

  return { allowed, remainingTokens, retryAfter };
}

/**
 * Token-bucket rate limiting middleware factory.
 *
 * Keys by `keyPrefix + ":" + (user?.id ? `${ip}:${user.id}` : ip)`.
 * If bucket is exhausted:
 * - Sets the `Retry-After` header to time required to refill 1 token (seconds, minimum 1).
 * - Passes `RateLimitError("Rate limit exceeded")` to the error handler (HTTP 429).
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const { max, windowSeconds, keyPrefix, redisClient, isRouteLimiter } = options;
  const store = new Map<string, BucketEntry>();
  const prefix = keyPrefix.endsWith(":") ? keyPrefix.slice(0, -1) : keyPrefix;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const cfIp = req.headers["cf-connecting-ip"];
      const ip = (typeof cfIp === "string" ? cfIp : undefined) || req.ip || "unknown";
      const identifier = user?.id ? `${ip}:${user.id}` : ip;
      const key = `${prefix}:${identifier}`;

      // Configurable limits via environment variables (TDD § 68)
      const envMaxKey = `RATE_LIMIT_${prefix.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_MAX`;
      const envMaxVal = process.env[envMaxKey];
      let effectiveMax = max;

      if (envMaxVal !== undefined && envMaxVal !== "") {
        const parsedMax = Number(envMaxVal);
        if (!isNaN(parsedMax) && parsedMax > 0) {
          effectiveMax = parsedMax;
        }
      } else if (isRouteLimiter && process.env.NODE_ENV === "test") {
        // High default ceiling for test suite to avoid cross-test starvation
        effectiveMax = 1000;
      }

      const envWindowKey = `RATE_LIMIT_${prefix.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_WINDOW`;
      const envWindowVal = process.env[envWindowKey];
      let effectiveWindowSeconds = windowSeconds;

      if (envWindowVal !== undefined && envWindowVal !== "") {
        const parsedWindow = Number(envWindowVal);
        if (!isNaN(parsedWindow) && parsedWindow > 0) {
          effectiveWindowSeconds = parsedWindow;
        }
      }

      const now = Date.now();
      let allowed = false;
      let remainingTokens = 0;
      let retryAfter = 0;

      // In production or when custom client is supplied, attempt Redis whenever client is not closed ('end')
      const client =
        redisClient || (process.env.NODE_ENV !== "test" ? redis : undefined);
      const shouldUseRedis = Boolean(client && client.status !== "end");

      if (shouldUseRedis && client) {
        try {
          const resRedis = await checkRedis(
            client,
            key,
            effectiveMax,
            effectiveWindowSeconds,
            now
          );
          allowed = resRedis.allowed;
          remainingTokens = resRedis.remainingTokens;
          retryAfter = resRedis.retryAfter;
        } catch (err) {
          logger.warn(
            { err, key },
            "Redis rate limiter failed, falling back to in-memory store"
          );
          const resMem = checkMemoryBucket(
            store,
            key,
            effectiveMax,
            effectiveWindowSeconds,
            now
          );
          allowed = resMem.allowed;
          remainingTokens = resMem.remainingTokens;
          retryAfter = resMem.retryAfter;
        }
      } else {
        const resMem = checkMemoryBucket(
          store,
          key,
          effectiveMax,
          effectiveWindowSeconds,
          now
        );
        allowed = resMem.allowed;
        remainingTokens = resMem.remainingTokens;
        retryAfter = resMem.retryAfter;
      }

      res.setHeader("X-RateLimit-Limit", effectiveMax.toString());
      res.setHeader(
        "X-RateLimit-Remaining",
        Math.max(0, Math.floor(remainingTokens)).toString()
      );

      if (!allowed) {
        res.setHeader("Retry-After", Math.max(1, retryAfter).toString());
        throw new RateLimitError("Rate limit exceeded");
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Creates standard route rate limiters conforming to TDD § 68.
 */
export function createRouteRateLimiter(
  keyPrefix: string,
  defaultMax: number,
  defaultWindowSeconds: number = 60
): RequestHandler {
  return createRateLimiter({
    keyPrefix,
    max: defaultMax,
    windowSeconds: defaultWindowSeconds,
    isRouteLimiter: true,
  });
}

// Pre-configured rate limiters for sensitive operations specified in TDD § 68
export const authRateLimiter = createRouteRateLimiter("auth", 30, 60);
export const quoteCreateRateLimiter = createRouteRateLimiter("quotes_create", 30, 60);
export const likeRateLimiter = createRouteRateLimiter("likes", 60, 60);
export const repostRateLimiter = createRouteRateLimiter("reposts", 30, 60);
export const followRateLimiter = createRouteRateLimiter("follows", 30, 60);
export const searchRateLimiter = createRouteRateLimiter("search", 60, 60);
export const notificationRateLimiter = createRouteRateLimiter("notifications", 60, 60);
export const adminRateLimiter = createRouteRateLimiter("admin", 100, 60);

