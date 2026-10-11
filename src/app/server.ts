import type { Server } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "../infrastructure/logging/logger";
import { disconnectDb } from "../infrastructure/database/prisma";

export function startServer(port: number = env.PORT): Promise<Server> {
  return new Promise((resolve, reject) => {
    const app = createApp();
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
