import { User, UserStatus } from "@prisma/client";
import { UserRepository } from "../repositories/user.repository";
import { prisma } from "../../../infrastructure/database/prisma";
import { stageOutboxEvent } from "../../../infrastructure/queue/outbox";
import {
  NotFoundError,
  ValidationError,
} from "../../../shared/errors/problem-details";
import { updateProfileSchema } from "../schemas/user.schemas";
import { formatZodErrors } from "../../../shared/utils/zod";

export class UserService {
  constructor(
    private readonly userRepo: UserRepository = new UserRepository()
  ) {}

  /**
   * Retrieves a user profile by public username.
   * Soft-deleted users are excluded by default in the repository layer.
   *
   * @param username The public username handle
   * @throws NotFoundError if the user is not found
   */
  async getProfileByUsername(username: string): Promise<User> {
    const user = await this.userRepo.findByUsername(username);
    if (!user) {
      throw new NotFoundError("Resource not found");
    }
    return user;
  }

  /**
   * Updates user presentation profile fields (displayName, bio).
   * Validates input against updateProfileSchema with strict mass-assignment prevention.
   *
   * @param userId The ID of the user to update
   * @param data Payload to validate and apply
   * @throws ValidationError if payload fails schema validation
   * @throws NotFoundError if the user does not exist
   */
  async updateProfile(userId: string, data: unknown): Promise<User> {
    const parseResult = updateProfileSchema.safeParse(data);
    if (!parseResult.success) {
      throw new ValidationError(
        "Validation failed",
        formatZodErrors(parseResult.error)
      );
    }

    const existingUser = await this.userRepo.findById(userId);
    if (!existingUser) {
      throw new NotFoundError("Resource not found");
    }

    return this.userRepo.updateProfile(userId, parseResult.data);
  }

  /**
   * Soft-deletes a user account.
   * Wraps status update to DELETED and UserDeleted outbox event staging
   * in an atomic database transaction.
   *
   * @param userId The ID of the user to soft-delete
   * @throws NotFoundError if the user does not exist or is already deleted
   */
  async softDeleteAccount(userId: string): Promise<User> {
    return prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
        },
      });

      if (!existingUser) {
        throw new NotFoundError("Resource not found");
      }

      const deletedUser = await tx.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.DELETED,
          deletedAt: new Date(),
        },
      });

      await stageOutboxEvent(tx, "UserDeleted", "User", userId, { userId });

      return deletedUser;
    });
  }

  /**
   * Confirms direct-to-R2 avatar upload and stages AvatarUploaded outbox event.
   * Validates key ownership to prevent arbitrary/foreign key manipulation.
   */
  async confirmAvatarUpload(
    userId: string,
    key: string
  ): Promise<{ message: string; key: string }> {
    const expectedPrefix = `uploads/avatars/${userId}/`;
    if (!key.startsWith(expectedPrefix)) {
      throw new ValidationError("Object key does not belong to authenticated user");
    }

    await prisma.$transaction(async (tx) => {
      await stageOutboxEvent(tx, "AvatarUploaded", "Media", userId, {
        userId,
        tempKey: key,
      });
    });

    return {
      message: "Avatar upload confirmed, processing queued",
      key,
    };
  }
}
