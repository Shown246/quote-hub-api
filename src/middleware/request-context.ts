import type { RequestHandler } from "express";
import type pino from "pino";
import { logger } from "../infrastructure/logging/logger";
import { generateUuidV7 } from "../shared/utils/uuidv7";

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: pino.Logger;
    }
  }
}

/**
 * Request context middleware.
 * Assigns or propagates x-request-id for distributed tracing and attaches
 * a request-scoped child logger to `req.log`.
 */
export const requestContextMiddleware: RequestHandler = (req, res, next): void => {
  const headerValue = req.headers["x-request-id"];
  let requestId: string;

  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    requestId = headerValue.trim();
  } else if (Array.isArray(headerValue) && headerValue[0] && headerValue[0].trim().length > 0) {
    requestId = headerValue[0].trim();
  } else {
    requestId = generateUuidV7();
  }

  req.id = requestId;
  res.setHeader("x-request-id", requestId);
  req.log = logger.child({ requestId });

  next();
};
