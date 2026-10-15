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
      connectSrc: ["'self'", env.FRONTEND_ORIGIN],
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

const ALLOWED_ORIGINS = new Set([
  env.FRONTEND_ORIGIN,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export const corsMiddleware: RequestHandler = cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
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
