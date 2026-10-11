import type { RequestHandler } from "express";
import type { User as DomainUser } from "@prisma/client";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../modules/auth/auth";
import { prisma } from "../infrastructure/database/prisma";
import {
  AuthenticationError,
  AuthorizationError,
} from "../shared/errors/problem-details";

export type { DomainUser };

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

declare global {
  namespace Express {
    interface Request {
      user?: DomainUser;
      session?: AuthSession;
    }
  }
}

function resolveHeaders(reqHeaders: unknown): Headers {
  if (reqHeaders instanceof Headers) {
    return reqHeaders;
  }
  return fromNodeHeaders(
    (reqHeaders as Record<string, string | string[] | undefined>) || {}
  );
}

/**
 * Middleware that strictly requires an authenticated session.
 * Resolves session via Better Auth, verifies domain user is active,
 * and attaches domain user to `req.user` and session to `req.session`.
 */
export const requireAuth: RequestHandler = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    const headers = resolveHeaders(req.headers);
    const session = await auth.api.getSession({ headers });

    if (!session || !session.user?.id) {
      throw new AuthenticationError(
        "Authentication required",
        "AUTHENTICATION_REQUIRED"
      );
    }

    const domainUser = await prisma.user.findFirst({
      where: {
        authId: session.user.id,
        deletedAt: null,
      },
    });

    if (!domainUser || domainUser.status === "DELETED") {
      throw new AuthenticationError(
        "User not found",
        "AUTHENTICATION_REQUIRED"
      );
    }

    if (domainUser.status === "SUSPENDED") {
      throw new AuthorizationError(
        "Account suspended",
        "ACCOUNT_SUSPENDED"
      );
    }

    req.user = domainUser;
    req.session = session;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware that optionally attaches an authenticated session.
 * If a valid active session and user exist, attaches them to `req.user` and `req.session`.
 * If no session or user is suspended/deleted, sets them to undefined and continues.
 */
export const optionalAuth: RequestHandler = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    const headers = resolveHeaders(req.headers);
    const session = await auth.api.getSession({ headers });

    if (!session || !session.user?.id) {
      req.user = undefined;
      req.session = undefined;
      return next();
    }

    const domainUser = await prisma.user.findFirst({
      where: {
        authId: session.user.id,
        deletedAt: null,
      },
    });

    if (!domainUser || domainUser.status === "SUSPENDED" || domainUser.status === "DELETED") {
      req.user = undefined;
      req.session = undefined;
      return next();
    }

    req.user = domainUser;
    req.session = session;

    next();
  } catch (error) {
    next(error);
  }
};
