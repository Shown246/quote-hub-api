import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma";
import { requireAuth } from "../../../middleware/auth";
import { requireAdmin } from "../../../middleware/authorization";
import { adminRateLimiter } from "../../../middleware/rate-limit";
import { adminUserController } from "../controllers/admin-user.controller";
import { adminQuoteService } from "../services/admin-quote.service";
import { auditService } from "../services/audit.service";
import { reconciliationService } from "../services/reconciliation.service";
import {
  AuthenticationError,
  ValidationError,
} from "../../../shared/errors/problem-details";
import { formatZodErrors } from "../../../shared/utils/zod";

export const listAdminQuotesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  userId: z.string().uuid().optional(),
  themeId: z.string().uuid().optional(),
  search: z.string().optional(),
  includeDeleted: z
    .preprocess((val) => val === "true" || val === true, z.boolean())
    .optional()
    .default(false),
});

const isValidDateString = (val: string) => !isNaN(Date.parse(val));

export const getAnalyticsQuerySchema = z.object({
  startDate: z
    .string()
    .refine(isValidDateString, {
      message: "Invalid startDate format",
    })
    .optional(),
  endDate: z
    .string()
    .refine(isValidDateString, {
      message: "Invalid endDate format",
    })
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const quoteIdParamSchema = z.object({
  quoteId: z.string().uuid(),
});

export { userIdParamSchema } from "../controllers/admin-user.controller";

export const listAuditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  actorId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
});

export const adminRouter = Router();

// Strictly restrict all admin routes to authenticated administrators
adminRouter.use(adminRateLimiter);
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

// User Moderation Endpoints
adminRouter.get("/users", adminUserController.listUsers);
adminRouter.get("/users/:userId", adminUserController.getUser);
adminRouter.patch("/users/:userId/status", adminUserController.updateUserStatus);

// Quote Moderation Endpoints
adminRouter.get(
  "/quotes",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = listAdminQuotesQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const result = await adminQuoteService.listQuotes(parseResult.data);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

adminRouter.delete(
  "/quotes/:quoteId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const quoteId = req.params.quoteId || req.params.id;
      if (!quoteId) {
        throw new ValidationError("Quote ID is required");
      }

      const paramParse = quoteIdParamSchema.safeParse({ quoteId });
      if (!paramParse.success) {
        throw new ValidationError(
          "Invalid quote ID format",
          formatZodErrors(paramParse.error)
        );
      }

      const reason =
        typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;

      await adminQuoteService.deleteQuote(req.user.id, quoteId, reason);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Analytics Historic Aggregation Endpoint
adminRouter.get(
  "/analytics",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = getAnalyticsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const { startDate, endDate, limit, offset } = parseResult.data;
      const where: Prisma.DailyMetricWhereInput = {};

      if (startDate || endDate) {
        where.metricDate = {};
        if (startDate) {
          where.metricDate.gte = new Date(startDate);
        }
        if (endDate) {
          where.metricDate.lte = new Date(endDate);
        }
      }

      const [metrics, total] = await Promise.all([
        prisma.dailyMetric.findMany({
          where,
          orderBy: { metricDate: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.dailyMetric.count({ where }),
      ]);

      res.status(200).json({ metrics, total });
    } catch (error) {
      next(error);
    }
  }
);

// Audit Log Retrieval Endpoint
adminRouter.get(
  "/audit-logs",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parseResult = listAuditLogsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const result = await auditService.listLogs(parseResult.data);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Counter Reconciliation Endpoint
adminRouter.post(
  ["/reconcile-counters", "/reconciliation/counters"],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await reconciliationService.reconcileCounters(
        req.user?.id
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);
