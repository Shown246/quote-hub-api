import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "../../app/config/env";
import { prisma } from "../../infrastructure/database/prisma";
import { sendVerificationEmail, sendPasswordResetEmail } from "../../infrastructure/email/resend";
import { logger } from "../../infrastructure/logging/logger";

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
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [
    env.FRONTEND_ORIGIN,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.NODE_ENV === "production",
    sendResetPassword: async ({ user, url, token }: any) => {
      const resetUrl = token
        ? `${env.FRONTEND_ORIGIN}/reset-password?token=${token}`
        : url;
      await sendPasswordResetEmail(user.email, resetUrl);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url, token }: any) => {
      const verificationUrl = token
        ? `${env.FRONTEND_ORIGIN}/verify-email?token=${token}`
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
