import { createHash } from "crypto";
import type { RequestHandler, Response } from "express";
import type { IdempotencyStatus } from "@prisma/client";
import { prisma } from "../infrastructure/database/prisma";
import { generateUuidV7 } from "../shared/utils/uuidv7";
import {
  AuthenticationError,
  ConflictError,
  ValidationError,
} from "../shared/errors/problem-details";
import { logger } from "../infrastructure/logging/logger";

const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Recursively sort object keys so identical JSON payloads serialize deterministically.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalize(obj[key]);
  }
  return result;
}

/**
 * Computes a deterministic SHA-256 hex digest of a request payload.
 */
export function computeRequestHash(body: unknown): string {
  const normalized = body !== undefined ? canonicalize(body) : {};
  const serialized = JSON.stringify(normalized ?? {});
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Database-backed mutation idempotency middleware.
 *
 * Enforces per-user, per-endpoint idempotency semantics when an `Idempotency-Key`
 * header is supplied:
 * - If no key is provided, passes through transparently.
 * - Replays cached 2xx/completed responses with `X-Cache-Idempotent: HIT` header.
 * - Returns RFC 9457 409 Conflict if payload hash differs from original request.
 * - Returns RFC 9457 409 Conflict if request is currently in-progress (`PENDING`).
 * - Transitions failed/expired keys to `PENDING` upon retry.
 * - Intercepts `res.send` to capture HTTP status and response payload, updating key to `COMPLETED` or `FAILED`.
 */
export function idempotencyMiddleware(endpoint: string): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const rawHeader = req.header("Idempotency-Key");
    if (!rawHeader) {
      return next();
    }

    const key = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader).trim();
    if (!key) {
      return next();
    }

    try {
      if (key.length > 255) {
        throw new ValidationError(
          "Idempotency-Key header must not exceed 255 characters"
        );
      }

      const userId = req.user?.id;
      if (!userId) {
        return next(
          new AuthenticationError(
            "Authentication required",
            "AUTHENTICATION_REQUIRED"
          )
        );
      }

      const requestHash = computeRequestHash(req.body);

      const existing = await prisma.idempotencyKey.findUnique({
        where: {
          uq_idempotency_user_key_ep: {
            userId,
            key,
            endpoint,
          },
        },
      });

      const now = new Date();
      const isExpired = existing ? existing.expiresAt <= now : false;

      if (existing && !isExpired) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictError("Idempotency key payload mismatch");
        }

        if (existing.status === "PENDING") {
          throw new ConflictError(
            "Request with this idempotency key is already in progress"
          );
        }

        if (existing.status === "COMPLETED") {
          res.setHeader("X-Cache-Idempotent", "HIT");
          const status = existing.responseStatus ?? 200;
          if (existing.responseBody !== null && existing.responseBody !== undefined) {
            res.status(status).json(existing.responseBody);
          } else {
            res.status(status).send();
          }
          return;
        }
        // If status === "FAILED", fall through to retry
      }

      let recordId: string;
      const expiresAt = new Date(Date.now() + DEFAULT_IDEMPOTENCY_TTL_MS);

      if (existing) {
        recordId = existing.id;
        await prisma.idempotencyKey.update({
          where: { id: existing.id },
          data: {
            requestHash,
            status: "PENDING",
            responseStatus: null,
            responseBody: null as any,
            expiresAt,
          },
        });
      } else {
        recordId = generateUuidV7();
        try {
          await prisma.idempotencyKey.create({
            data: {
              id: recordId,
              userId,
              key,
              endpoint,
              requestHash,
              status: "PENDING",
              expiresAt,
            },
          });
        } catch (error: any) {
          if (error?.code === "P2002") {
            const raceRecord = await prisma.idempotencyKey.findUnique({
              where: {
                uq_idempotency_user_key_ep: { userId, key, endpoint },
              },
            });
            if (raceRecord && raceRecord.requestHash !== requestHash) {
              throw new ConflictError("Idempotency key payload mismatch");
            }
            throw new ConflictError(
              "Request with this idempotency key is already in progress"
            );
          }
          throw error;
        }
      }

      // Intercept res.send to capture response status code and body
      const originalSend = res.send.bind(res);
      let isIntercepted = false;

      res.send = function (body?: any): Response {
        if (isIntercepted) {
          return originalSend(body);
        }
        isIntercepted = true;

        let parsedBody: any = null;
        if (body !== undefined && body !== null) {
          if (typeof body === "string") {
            try {
              parsedBody = JSON.parse(body);
            } catch {
              parsedBody = body;
            }
          } else if (Buffer.isBuffer(body)) {
            const str = body.toString("utf8");
            try {
              parsedBody = JSON.parse(str);
            } catch {
              parsedBody = str;
            }
          } else {
            parsedBody = body;
          }
        }

        const statusCode = res.statusCode;
        const isSuccess = statusCode >= 200 && statusCode < 400;
        const finalStatus: IdempotencyStatus = isSuccess ? "COMPLETED" : "FAILED";

        prisma.idempotencyKey
          .update({
            where: { id: recordId },
            data: {
              status: finalStatus,
              responseStatus: statusCode,
              responseBody: parsedBody,
            },
          })
          .catch((err) => {
            logger.warn({ err, recordId }, "Failed to update idempotency key status");
          })
          .finally(() => {
            originalSend(body);
          });

        return res;
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
