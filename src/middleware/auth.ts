import crypto from "crypto";
import type { RequestHandler } from "express";
import type { User as DomainUser } from "@prisma/client";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../modules/auth/auth";
import { prisma } from "../infrastructure/database/prisma";
import { redis, safeRedisCall } from "../infrastructure/redis/redis";
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
 * Extracts raw authentication token from Authorization Bearer header or cookie.
 */
export function extractRawAuthToken(req: {
  headers?: Record<string, any>;
  cookies?: Record<string, any>;
}): string | null {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  if (req.cookies) {
    const cookieVal =
      req.cookies["better-auth.session_token"] ??
      req.cookies["__Secure-better-auth.session_token"];
    if (typeof cookieVal === "string") {
      return cookieVal.trim();
    }
  }

  const cookieHeader = req.headers?.cookie;
  if (typeof cookieHeader === "string") {
    const match = cookieHeader.match(
      /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/
    );
    if (match && match[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }

  return null;
}

/**
 * Computes SHA-256 hash of session token for Redis cache key namespacing.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Invalidates all active Redis session caches for a specific user ID.
 */
export async function invalidateUserSessionCache(
  userId: string
): Promise<void> {
  await safeRedisCall(
    async (client) => {
      const target = client ?? redis;
      const userSessionsKey = `auth:user-sessions:${userId}`;
      const tokenHashes = await target.smembers(userSessionsKey);
      const pipeline = target.pipeline();
      if (tokenHashes && tokenHashes.length > 0) {
        for (const hash of tokenHashes) {
          pipeline.del(`auth:session:${hash}`);
        }
      }
      pipeline.del(userSessionsKey);
      await pipeline.exec();
    },
    async () => {}
  );
}

function restoreCachedDates(cached: {
  session: AuthSession;
  user: DomainUser;
}): void {
  if (cached.session?.session) {
    if (cached.session.session.expiresAt) {
      cached.session.session.expiresAt = new Date(
        cached.session.session.expiresAt
      );
    }
    if (cached.session.session.createdAt) {
      cached.session.session.createdAt = new Date(
        cached.session.session.createdAt
      );
    }
    if (cached.session.session.updatedAt) {
      cached.session.session.updatedAt = new Date(
        cached.session.session.updatedAt
      );
    }
  }
  if (cached.session?.user) {
    if (cached.session.user.createdAt) {
      cached.session.user.createdAt = new Date(cached.session.user.createdAt);
    }
    if (cached.session.user.updatedAt) {
      cached.session.user.updatedAt = new Date(cached.session.user.updatedAt);
    }
  }
  if (cached.user) {
    if (cached.user.createdAt) {
      cached.user.createdAt = new Date(cached.user.createdAt);
    }
    if (cached.user.updatedAt) {
      cached.user.updatedAt = new Date(cached.user.updatedAt);
    }
    if (cached.user.deletedAt) {
      cached.user.deletedAt = new Date(cached.user.deletedAt);
    }
    if (cached.user.suspendedAt) {
      cached.user.suspendedAt = new Date(cached.user.suspendedAt);
    }
    if (cached.user.suspendedUntil) {
      cached.user.suspendedUntil = new Date(cached.user.suspendedUntil);
    }
  }
}

async function cacheUserSession(
  tokenHash: string,
  session: AuthSession,
  user: DomainUser
): Promise<void> {
  await safeRedisCall(
    async (client) => {
      const target = client ?? redis;
      const pipeline = target.pipeline();
      pipeline.set(
        `auth:session:${tokenHash}`,
        JSON.stringify({ session, user }),
        "EX",
        300
      );
      pipeline.sadd(`auth:user-sessions:${user.id}`, tokenHash);
      pipeline.expire(`auth:user-sessions:${user.id}`, 300);
      await pipeline.exec();
    },
    async () => {}
  );
}

/**
 * Middleware that strictly requires an authenticated session.
 * Resolves session via Redis cache (hit) or Better Auth + PostgreSQL (miss).
 * Verifies domain user is active and attaches user to `req.user` and session to `req.session`.
 */
export const requireAuth: RequestHandler = async (
  req,
  res,
  next
): Promise<void> => {
  try {
    const rawToken = extractRawAuthToken(req);
    const tokenHash = rawToken ? hashToken(rawToken) : null;

    if (tokenHash) {
      const cached = await safeRedisCall(
        async (client) => {
          const target = client ?? redis;
          const raw = await target.get(`auth:session:${tokenHash}`);
          if (!raw) return null;
          return JSON.parse(raw) as { session: AuthSession; user: DomainUser };
        },
        async () => null
      );

      if (cached) {
        const isExpired =
          new Date(cached.session?.session?.expiresAt).getTime() <= Date.now();

        if (!isExpired) {
          if (cached.user?.status === "DELETED" || cached.user?.deletedAt) {
            throw new AuthenticationError(
              "User not found",
              "AUTHENTICATION_REQUIRED"
            );
          }

          if (cached.user?.status === "SUSPENDED") {
            throw new AuthorizationError(
              "Account suspended",
              "ACCOUNT_SUSPENDED"
            );
          }

          if (cached.user?.status === "ACTIVE") {
            restoreCachedDates(cached);
            await safeRedisCall(
              async (client) => {
                const target = client ?? redis;
                const pipeline = target.pipeline();
                pipeline.expire(`auth:session:${tokenHash}`, 300);
                if (cached.user?.id) {
                  pipeline.expire(`auth:user-sessions:${cached.user.id}`, 300);
                }
                await pipeline.exec();
              },
              async () => {}
            );

            req.user = cached.user;
            req.session = cached.session;
            return next();
          }
        }
      }
    }

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

    if (tokenHash) {
      await cacheUserSession(tokenHash, session, domainUser);
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
    const rawToken = extractRawAuthToken(req);
    const tokenHash = rawToken ? hashToken(rawToken) : null;

    if (tokenHash) {
      const cached = await safeRedisCall(
        async (client) => {
          const target = client ?? redis;
          const raw = await target.get(`auth:session:${tokenHash}`);
          if (!raw) return null;
          return JSON.parse(raw) as { session: AuthSession; user: DomainUser };
        },
        async () => null
      );

      if (cached) {
        const isExpired =
          new Date(cached.session?.session?.expiresAt).getTime() <= Date.now();

        if (!isExpired) {
          if (
            cached.user?.status !== "ACTIVE" ||
            Boolean(cached.user?.deletedAt)
          ) {
            req.user = undefined;
            req.session = undefined;
            return next();
          }

          restoreCachedDates(cached);
          await safeRedisCall(
            async (client) => {
              const target = client ?? redis;
              const pipeline = target.pipeline();
              pipeline.expire(`auth:session:${tokenHash}`, 300);
              if (cached.user?.id) {
                pipeline.expire(`auth:user-sessions:${cached.user.id}`, 300);
              }
              await pipeline.exec();
            },
            async () => {}
          );

          req.user = cached.user;
          req.session = cached.session;
          return next();
        }
      }
    }

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

    if (
      !domainUser ||
      domainUser.status === "SUSPENDED" ||
      domainUser.status === "DELETED"
    ) {
      req.user = undefined;
      req.session = undefined;
      return next();
    }

    if (tokenHash) {
      await cacheUserSession(tokenHash, session, domainUser);
    }

    req.user = domainUser;
    req.session = session;

    next();
  } catch (error) {
    next(error);
  }
};
