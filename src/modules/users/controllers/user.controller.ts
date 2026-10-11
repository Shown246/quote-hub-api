import { Request, Response, NextFunction } from "express";
import { UserService } from "../services/user.service";
import { generatePresignedUploadUrl } from "../../media/services/avatar.service";
import {
  avatarUploadRequestSchema,
  avatarConfirmRequestSchema,
  toUserProfileResponse,
  formatZodErrors,
  UserProfileResponse,
} from "../schemas/user.schemas";
import {
  AuthenticationError,
  ValidationError,
} from "../../../shared/errors/problem-details";

export class UserController {
  constructor(private readonly userService: UserService = new UserService()) {}

  /**
   * Retrieves a public user profile by username handle.
   * Returns a sanitized UserProfileResponse stripping internal fields.
   */
  getProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await this.userService.getProfileByUsername(
        req.params.username
      );
      res.status(200).json(toUserProfileResponse(user));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Updates authenticated user's profile presentation fields.
   * Identity is derived strictly from req.user.id.
   * Returns a sanitized UserProfileResponse stripping internal fields.
   */
  updateProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const updatedUser = await this.userService.updateProfile(
        req.user.id,
        req.body
      );
      res.status(200).json(toUserProfileResponse(updatedUser));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Validates avatar upload request body and generates a presigned R2 upload URL.
   * Identity is derived strictly from req.user.id.
   */
  requestAvatarUpload = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const parseResult = avatarUploadRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const { contentType, contentLength } = parseResult.data;

      const result = await generatePresignedUploadUrl(
        req.user.id,
        contentType,
        contentLength
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Confirms upload of avatar to R2, validates key ownership, and enqueues processing.
   * Conforms to TDD §§ 63, 65.
   */
  confirmAvatarUpload = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      const parseResult = avatarConfirmRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Validation failed",
          formatZodErrors(parseResult.error)
        );
      }

      const result = await this.userService.confirmAvatarUpload(
        req.user.id,
        parseResult.data.key
      );

      res.status(202).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Soft-deletes authenticated user's account.
   * Identity is derived strictly from req.user.id.
   */
  deleteAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError(
          "Authentication required",
          "AUTHENTICATION_REQUIRED"
        );
      }

      await this.userService.softDeleteAccount(req.user.id);
      res.status(200).json({ message: "Account deleted successfully" });
    } catch (error) {
      next(error);
    }
  };
}

export const userController = new UserController();
export { toUserProfileResponse };
export type { UserProfileResponse };
