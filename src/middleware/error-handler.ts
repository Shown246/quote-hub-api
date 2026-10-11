import { ErrorRequestHandler } from "express";
import { toProblemDetails } from "../shared/errors/problem-details";
import { captureExceptionWithContext } from "../infrastructure/logging/sentry";

export const errorHandler: ErrorRequestHandler = (err, req, res, next): void => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const rawHeader = req.headers["x-request-id"];
  const headerId =
    typeof rawHeader === "string"
      ? rawHeader
      : Array.isArray(rawHeader)
        ? rawHeader[0]
        : undefined;

  const rawReqId = (req as { id?: unknown }).id;
  const reqId = typeof rawReqId === "string" ? rawReqId : undefined;
  const requestId = headerId || reqId || undefined;

  const problem = toProblemDetails(err, requestId);

  if (problem.status >= 500) {
    try {
      captureExceptionWithContext(err, req);
    } catch {
      // Avoid throwing in error handler if Sentry capture throws
    }

    try {
      const reqWithLogger = req as {
        log?: { error?: (...args: unknown[]) => void };
        logger?: { error?: (...args: unknown[]) => void };
      };
      const logger = reqWithLogger.log || reqWithLogger.logger;
      if (logger && typeof logger.error === "function") {
        logger.error({ err, requestId }, "Unhandled server error");
      }
    } catch {
      // Avoid throwing in error handler if logger throws
    }
  }

  res.setHeader("Content-Type", "application/problem+json");
  res.status(problem.status).json(problem);
};
