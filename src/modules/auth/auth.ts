import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "../../app/config/env";
import { prisma } from "../../infrastructure/database/prisma";
import { sendVerificationEmail, sendPasswordResetEmail } from "../../infrastructure/email/resend";

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
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail(user.email, url);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url);
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
});

export type Auth = typeof auth;
