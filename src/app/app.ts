import express, { Express } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../modules/auth/auth";
import { initSentry } from "../infrastructure/logging/sentry";
import { securityMiddleware } from "../middleware/security";
import { requestContextMiddleware } from "../middleware/request-context";
import { healthRouter } from "./routes/health.routes";
import { userRouter } from "../modules/users/routes/user.routes";
import { themeRouter } from "../modules/themes/routes/theme.routes";
import { quoteRouter } from "../modules/quotes/routes/quote.routes";
import { trendingRouter } from "../modules/trending/routes/trending.routes";
import { feedRouter } from "../modules/feeds/routes/feed.routes";
import { searchRouter } from "../modules/search/routes/search.routes";
import { notificationRouter } from "../modules/notifications/routes/notification.routes";
import { adminRouter } from "../modules/admin/routes/admin.routes";
import { authRateLimiter } from "../middleware/rate-limit";
import { serveSwagger } from "../infrastructure/docs/openapi";
import { errorHandler } from "../middleware/error-handler";
import { NotFoundError } from "../shared/errors/problem-details";

export function createApp(): Express {
  const app: Express = express();

  initSentry(app);

  app.use(securityMiddleware);
  app.use(express.json());
  app.use(requestContextMiddleware);

  // Better Auth routes with configurable rate limiting (TDD § 68)
  app.all("/api/auth/*", authRateLimiter, toNodeHandler(auth));
  app.all("/api/v1/auth/*", authRateLimiter, toNodeHandler(auth));

  app.use("/health", healthRouter);
  app.use("/docs", serveSwagger());
  app.use("/api/v1/users", userRouter);
  app.use("/api/v1/themes", themeRouter);
  app.use("/api/v1/quotes", quoteRouter);
  app.use("/api/v1/trending", trendingRouter);
  app.use("/api/v1/feed", feedRouter);
  app.use("/api/v1/search", searchRouter);
  app.use("/api/v1/notifications", notificationRouter);
  app.use("/api/v1/admin", adminRouter);

  // 404 unhandled route handler
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  // Terminal error handler
  app.use(errorHandler);

  return app;
}
