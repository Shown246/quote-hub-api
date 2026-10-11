import Redis from "ioredis";
import { env } from "../../app/config/env";
import { logger } from "../logging/logger";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

redis.on("error", (err) => {
  logger.warn({ err }, "Redis client connection error");
});

export async function safeRedisCall<T>(
  op: (client: Redis) => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> {
  try {
    return await op(redis);
  } catch (err) {
    logger.warn({ err }, "Redis operation failed, falling back");
    return await fallback();
  }
}

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch (err) {
    logger.warn({ err }, "Failed to quit Redis client cleanly, disconnecting");
    redis.disconnect();
  }
}
