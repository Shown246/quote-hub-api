import type { Server } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "../infrastructure/logging/logger";
import { disconnectDb, prisma } from "../infrastructure/database/prisma";
import { UserService } from "../modules/users/services/user.service";

export async function syncOrphanedAuthUsers(): Promise<void> {
  try {
    const authUsersWithoutDomain = await prisma.authUser.findMany({
      where: {
        user: null,
      },
    });
    if (authUsersWithoutDomain.length > 0) {
      logger.info(
        `Synchronizing ${authUsersWithoutDomain.length} orphaned auth users to domain profiles...`
      );
      const userService = new UserService();
      for (const authUser of authUsersWithoutDomain) {
        await userService.ensureDomainUserForAuth(
          authUser.id,
          authUser.name,
          authUser.email,
          authUser.image
        );
      }
      logger.info("Orphaned auth users successfully synchronized");
    }
  } catch (err) {
    logger.warn({ err }, "Could not sync orphaned auth users during bootstrap");
  }
}

export const BOOTSTRAP_THEMES = [
  {
    id: "018f3a2c-0000-7000-8000-000000000001",
    key: "classic-serif",
    name: "Classic Serif",
    isActive: true,
  },
  {
    id: "018f3a2c-0000-7000-8000-000000000002",
    key: "modern-sans",
    name: "Modern Sans",
    isActive: true,
  },
  {
    id: "018f3a2c-0000-7000-8000-000000000003",
    key: "editorial",
    name: "Editorial",
    isActive: true,
  },
  {
    id: "018f3a2c-0000-7000-8000-000000000004",
    key: "minimalist",
    name: "Minimalist",
    isActive: true,
  },
];

export async function ensureDefaultThemes(): Promise<void> {
  try {
    const themeCount = await prisma.theme.count();
    if (themeCount === 0) {
      logger.info("No themes found in database, bootstrapping default themes...");
      for (const theme of BOOTSTRAP_THEMES) {
        await prisma.theme.upsert({
          where: { key: theme.key },
          create: theme,
          update: { name: theme.name, isActive: theme.isActive },
        });
      }
      const { invalidateCache } = await import("../infrastructure/redis/cache");
      await invalidateCache("cache:themes:active");
      logger.info("Default themes successfully bootstrapped");
    }
  } catch (err) {
    logger.warn({ err }, "Could not ensure default themes during bootstrap");
  }
}

export function startServer(port: number = env.PORT): Promise<Server> {
  return new Promise((resolve, reject) => {
    const app = createApp();
    syncOrphanedAuthUsers().catch(() => {});
    ensureDefaultThemes().catch(() => {});
    const server = app.listen(port, () => {
      logger.info(`Server listening on port ${port} in ${env.NODE_ENV} mode`);
      resolve(server);
    });

    server.on("error", (err) => {
      reject(err);
    });

    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;

      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      server.close(async (err) => {
        if (err) {
          logger.error({ err }, "Error closing HTTP server");
        }
        try {
          await disconnectDb();
          logger.info("Database connection closed");
        } catch (dbErr) {
          logger.error({ err: dbErr }, "Error disconnecting database during shutdown");
        }
      });
    };

    const onSigTerm = () => shutdown("SIGTERM");
    const onSigInt = () => shutdown("SIGINT");

    process.once("SIGTERM", onSigTerm);
    process.once("SIGINT", onSigInt);

    server.once("close", () => {
      process.removeListener("SIGTERM", onSigTerm);
      process.removeListener("SIGINT", onSigInt);
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.error(err);
    process.exit(1);
  });
}
