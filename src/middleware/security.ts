import type { RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "../app/config/env";

export const helmetMiddleware: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      imgSrc: [
        "'self'",
        "data:",
        ...(env.R2_PUBLIC_URL ? [env.R2_PUBLIC_URL] : []),
        env.FRONTEND_ORIGIN,
      ],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      connectSrc: [
        "'self'",
        env.FRONTEND_ORIGIN,
        ...(env.NODE_ENV === "production" ? [] : [
          "https://*.trycloudflare.com",
          "https://*.vercel.app",
        ]),
      ],
      upgradeInsecureRequests: [],
    },
  },
  xFrameOptions: { action: "sameorigin" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

export const ALLOWED_ORIGINS = new Set([
  env.FRONTEND_ORIGIN,
  ...(env.NODE_ENV === "production" ? [] : [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]),
]);

export function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) {
    return true;
  }

  if (env.NODE_ENV === "production") {
    return false;
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    // Allow Cloudflare quick tunnels (*.trycloudflare.com)
    if (url.protocol === "https:" && hostname.endsWith(".trycloudflare.com")) {
      return true;
    }

    // Allow Vercel deployments and branch previews (*.vercel.app)
    if (
      url.protocol === "https:" &&
      (hostname === "vercel.app" || hostname.endsWith(".vercel.app"))
    ) {
      return true;
    }

    // Allow loopback origins with any port in development
    if (
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export const corsMiddleware: RequestHandler = cors({
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
});

export const securityMiddleware: RequestHandler[] = [
  helmetMiddleware,
  corsMiddleware,
];
