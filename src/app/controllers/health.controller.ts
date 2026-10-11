import { Request, Response } from "express";
import { pingDb } from "../../infrastructure/database/prisma";

export function getLiveness(_req: Request, res: Response): void {
  res.status(200).json({
    status: "alive",
    timestamp: new Date().toISOString(),
  });
}

export async function getReadiness(_req: Request, res: Response): Promise<void> {
  const isDbHealthy = await pingDb();

  if (isDbHealthy) {
    res.status(200).json({
      status: "ready",
      timestamp: new Date().toISOString(),
      services: {
        database: "healthy",
      },
    });
    return;
  }

  res.status(503).json({
    status: "degraded",
    timestamp: new Date().toISOString(),
    services: {
      database: "unhealthy",
    },
  });
}
