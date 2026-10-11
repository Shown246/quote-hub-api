import { Request, Response, NextFunction } from "express";
import { UserStatus } from "@prisma/client";
import { z } from "zod";
import {
  AdminUserService,
  adminUserService,
} from "../services/admin-user.service";
import {
  AuthenticationError,
  ValidationError,
} from "../../../shared/errors/problem-details";
import { formatZodErrors } from "../../../shared/utils/zod";

export const listUsersQuerySchema = z.object({
  status: z.nativeEnum(UserStatus).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const userIdParamSchema = z.object({
  userId: z.string().uuid(),
});

export const updateUserStatusSchema = z
  .object({
    status: z.nativeEnum(UserStatus),
    reason: z.string().trim().optional().nullable(),
    until: z.coerce.date().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.status === UserStatus.SUSPENDED) {
        return !!data.reason && data.reason.trim().length > 0;
      }
      return true;
    },
    {
      message: "Suspension reason is required when suspending a user",
      path: ["reason"],
    }
  );

export class AdminUserController {
  constructor(
    private readonly adminUserServiceInstance: AdminUserService = adminUserService
  ) {}

  /**
   * Handles GET /api/v1/admin/users:
   * Retrieves paginated list of users matching query filters.
   */
  listUsers = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const parseResult = listUsersQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const { status, search, limit, offset } = parseResult.data;
      const result = await this.adminUserServiceInstance.listUsers({
        status,
        search,
        limit,
        offset,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles GET /api/v1/admin/users/:id:
   * Retrieves a specific user profile by user ID.
   */
  getUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const rawUserId = req.params.userId || req.params.id;
      if (!rawUserId) {
        throw new ValidationError("User ID is required");
      }

      const paramResult = userIdParamSchema.safeParse({ userId: rawUserId });
      if (!paramResult.success) {
        throw new ValidationError(
          "Invalid user ID format",
          formatZodErrors(paramResult.error)
        );
      }

      const user = await this.adminUserServiceInstance.getUserById(rawUserId);
      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handles PATCH /api/v1/admin/users/:id/status:
   * Modifies user account status (ACTIVE, SUSPENDED, DELETED) and logs audit trail.
   */
  updateUserStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const rawUserId = req.params.userId || req.params.id;
      if (!rawUserId) {
        throw new ValidationError("User ID is required");
      }

      const paramResult = userIdParamSchema.safeParse({ userId: rawUserId });
      if (!paramResult.success) {
        throw new ValidationError(
          "Invalid user ID format",
          formatZodErrors(paramResult.error)
        );
      }

      const parseResult = updateUserStatusSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const { status, reason, until } = parseResult.data;
      const updatedUser = await this.adminUserServiceInstance.updateUserStatus(
        req.user.id,
        rawUserId,
        status,
        reason ?? undefined,
        until
      );

      res.status(200).json(updatedUser);
    } catch (error) {
      next(error);
    }
  };
}

export const adminUserController = new AdminUserController();
