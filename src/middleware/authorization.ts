import type { RequestHandler } from "express";
import {
  AuthenticationError,
  AuthorizationError,
} from "../shared/errors/problem-details";

/**
 * Role-based authorization middleware restricting access to active administrators.
 * Expects `req.user` to be populated by upstream authentication middleware (`requireAuth`).
 *
 * - If `req.user` is missing: throws 401 AuthenticationError (`AUTHENTICATION_REQUIRED`)
 * - If `req.user.role !== 'ADMIN'` or `req.user.status !== 'ACTIVE'`: throws 403 AuthorizationError (`ADMIN_ACCESS_REQUIRED`)
 * - Otherwise: forwards request to the next handler via `next()`
 */
export const requireAdmin: RequestHandler = (req, _res, next): void => {
  try {
    if (!req.user) {
      throw new AuthenticationError(
        "Authentication required",
        "AUTHENTICATION_REQUIRED"
      );
    }

    if (req.user.role !== "ADMIN" || req.user.status !== "ACTIVE") {
      throw new AuthorizationError(
        "Administrator access required",
        "ADMIN_ACCESS_REQUIRED"
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};
