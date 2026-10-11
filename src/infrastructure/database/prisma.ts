import { PrismaClient } from "@prisma/client";
import { env } from "../../app/config/env";
import { logger } from "../logging/logger";

const PING_TIMEOUT_MS = 3000;

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: env.DATABASE_URL,
    },
  },
  log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

export async function pingDb(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Database ping timed out after ${PING_TIMEOUT_MS}ms`));
      }, PING_TIMEOUT_MS);
    });

    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      timeoutPromise,
    ]);

    return true;
  } catch (error) {
    logger.error({ err: error }, "Database ping failed");
    return false;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
