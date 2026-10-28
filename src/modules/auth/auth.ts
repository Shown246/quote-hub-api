import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "../../app/config/env";
import { prisma } from "../../infrastructure/database/prisma";
import { sendVerificationEmail, sendPasswordResetEmail } from "../../infrastructure/email/resend";
import { logger } from "../../infrastructure/logging/logger";
import { isAllowedOrigin } from "../../middleware/security";

const betterAuthUrlParsed = (() => {
  try {
    return new URL(env.BETTER_AUTH_URL);
  } catch {
    return undefined;
  }
})();

const allowedHosts = [
  "*.trycloudflare.com",
  "localhost",
  "localhost:*",
  "127.0.0.1",
  "127.0.0.1:*",
  ...(betterAuthUrlParsed ? [betterAuthUrlParsed.host, betterAuthUrlParsed.hostname] : []),
];

export function resolveFrontendOrigin(request?: Request): string {
  if (request && typeof request.headers?.get === "function") {
    const origin = request.headers.get("origin");
    if (origin && isAllowedOrigin(origin)) {
      return origin;
    }
    const referer = request.headers.get("referer");
    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (isAllowedOrigin(refererOrigin)) {
          return refererOrigin;
        }
      } catch {
        // Ignore invalid referer URL
      }
    }
  }
  return env.FRONTEND_ORIGIN;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    ...({
      schema: {
        user: "authUser",
        session: "authSession",
        account: "authAccount",
        verification: "authVerification",
      },
    } as any),
  }),
  user: {
    modelName: "authUser",
  },
  session: {
    modelName: "authSession",
  },
  account: {
    modelName: "authAccount",
  },
  verification: {
    modelName: "authVerification",
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.NODE_ENV === "production" ? env.BETTER_AUTH_URL : {
    allowedHosts,
    fallback: env.BETTER_AUTH_URL,
    protocol: "auto",
  },
  trustedOrigins: [
    env.FRONTEND_ORIGIN,
    ...(env.NODE_ENV === "production" ? [] : [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://*.trycloudflare.com",
      "https://*.vercel.app",
    ]),
  ],
  advanced: {
    trustedProxyHeaders: true,
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.NODE_ENV === "production",
    sendResetPassword: async ({ user, url, token }: any, request?: Request) => {
      const frontendOrigin = resolveFrontendOrigin(request);
      const resetUrl = token
        ? `${frontendOrigin}/reset-password?token=${token}`
        : url;
      logger.info({ email: user.email }, "Triggering password reset dispatch");
      await sendPasswordResetEmail(user.email, resetUrl);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url, token }: any, request?: Request) => {
      const frontendOrigin = resolveFrontendOrigin(request);
      const verificationUrl = token
        ? `${frontendOrigin}/verify-email?token=${token}`
        : url;
      logger.info({ email: user.email }, "Triggering email verification dispatch");
      await sendVerificationEmail(user.email, verificationUrl);
    },
  },
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  databaseHooks: {
    user: {
      create: {
        after: async (user: any) => {
          try {
            if (user?.id) {
              const { UserService } = await import("../users/services/user.service");
              const userService = new UserService();
              await userService.ensureDomainUserForAuth(
                user.id,
                user.name,
                user.email,
                user.image
              );
            }
          } catch (err) {
            logger.error({ err, userId: user?.id }, "Failed to create domain user in user.create hook");
          }
        },
      },
    },
    authUser: {
      create: {
        after: async (user: any) => {
          try {
            if (user?.id) {
              const { UserService } = await import("../users/services/user.service");
              const userService = new UserService();
              await userService.ensureDomainUserForAuth(
                user.id,
                user.name,
                user.email,
                user.image
              );
            }
          } catch (err) {
            logger.error({ err, userId: user?.id }, "Failed to create domain user in authUser.create hook");
          }
        },
      },
    },
    session: {
      create: {
        after: async (session: any) => {
          try {
            if (session?.userId) {
              const { UserService } = await import("../users/services/user.service");
              const userService = new UserService();
              await userService.ensureDomainUserForAuth(session.userId);
            }
          } catch (err) {
            logger.error({ err, userId: session?.userId }, "Failed to ensure domain user in session.create hook");
          }
        },
      },
    },
    authSession: {
      create: {
        after: async (session: any) => {
          try {
            if (session?.userId) {
              const { UserService } = await import("../users/services/user.service");
              const userService = new UserService();
              await userService.ensureDomainUserForAuth(session.userId);
            }
          } catch (err) {
            logger.error({ err, userId: session?.userId }, "Failed to ensure domain user in authSession.create hook");
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
